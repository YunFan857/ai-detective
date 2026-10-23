/**
 * 流水线第六步：判决。
 * 规则优先：先按独立证人与时间线走规则引擎，模型只负责组织摘要与辟谣卡；
 * 规则给不出结论时才把选择权交给模型，且只能在部分属实/断章取义/无法证实中选。
 * 模型失败不抛错，统一降级为规则文案。
 */
import { z } from 'zod';
import {
  VerdictLevelSchema,
  VerdictSchema,
  type Claim,
  type ClaimVerdict,
  type Source,
  type SourceGroup,
  type Stance,
  type Tier,
  type TimelineStep,
  type Verdict,
  type VerdictLevel,
} from '../../types/case';
import { chatJSON } from '../llm';

/** 每个疑点最多喂给模型的独立证人数 */
const MAX_WITNESSES_PER_CLAIM = 10;
/** headline 字数上限 */
const MAX_HEADLINE_CHARS = 12;
/** 辟谣卡标题字数上限 */
const MAX_TITLE_CHARS = 16;
/** 辟谣卡正文字数上限 */
const MAX_BODY_CHARS = 80;
/** 来源尾注字数上限 */
const MAX_SOURCE_TAIL_CHARS = 36;
/** 摘要中单条来源编号的最大长度 */
const MAX_CITATION_TOKEN_CHARS = 80;
/** 链接校验超时（毫秒） */
const REACH_TIMEOUT_MS = 5_000;
/** 单一来源时的 headline 提示 */
const SINGLE_HEADLINE = '仅单一来源，置信度低';
/** 零来源时的 headline */
const NO_EVIDENCE_HEADLINE = '我不知道';
/** 单一来源时置信度上限 */
const SINGLE_CONFIDENCE_CAP = 0.5;

const TEMPERATURE = 0;
const TIMEOUT_MS = 60_000;

const TIER_RANK: Record<Tier, number> = {
  official: 4,
  media: 3,
  self: 2,
  marketing: 1,
  unknown: 0,
};

/** 传播变形表述：只有同源转载之间的走样才计入。 */
const MUTATION_RE =
  /夸大|删去|删除|省略|改为|改写|偷换|断章|曲解|嫁接|篡改|升级为|包装|误读|截取|变成|固化成|伪造/;

const CITATION_RE = /\[([^[\]]{1,80})\]/g;

const TIER_NAMES: Record<Tier, string> = {
  official: '官方',
  media: '权威媒体',
  self: '自媒体',
  marketing: '营销号',
  unknown: '未分级',
};

/** 独立证人数决定的三态底线。 */
export type EvidenceState = 'multi' | 'single' | 'none';

/** 同一疑点的正反冲突记录。 */
export type ClaimConflict = {
  supportIds: string[];
  refuteIds: string[];
  resolution: string;
};

const LEVEL_NAMES: Record<VerdictLevel, string> = {
  true: '属实',
  partly_true: '部分属实',
  out_of_context: '断章取义',
  unverified: '无法证实',
  false: '谣言',
};

const FALLBACK_HEADLINES: Record<VerdictLevel, string> = {
  true: '多方印证：说法基本属实',
  false: '系谣言：权威已明确否认',
  out_of_context: '断章取义：原话被改写',
  partly_true: '部分属实：细节被夸大',
  unverified: '证据不足：暂无法证实',
};

const FALLBACK_TITLES: Record<VerdictLevel, string> = {
  true: '这条说法基本靠谱',
  false: '别转了，这是谣言',
  out_of_context: '原话被改写了',
  partly_true: '一半真一半夸张',
  unverified: '证据不足，先别信',
};

const FALLBACK_BODIES: Record<VerdictLevel, string> = {
  true: '这条说法基本属实，多个来源都能对上，可以放心转告家人。',
  false: '这条说法是假的，权威来源已经明确否认，别再往群里转了。',
  out_of_context: '原研究只说可能有关，传到群里就被改成了已经证实，别被带偏了。',
  partly_true: '这事有一部分是真的，但关键细节被夸大了，转发前先看清楚。',
  unverified: '目前没有找到足够可靠的来源，先别急着相信，也别急着转发。',
};

const LEVEL_TAILS: Record<VerdictLevel, string> = {
  true: '多方独立来源相互印证，说法基本属实',
  false: '权威来源已明确否认，该说法不成立',
  out_of_context: '原始来源存在，但传播中被明显改写，属于断章取义',
  partly_true: '部分要素属实，关键细节存在夸大或不实',
  unverified: '独立证据不足，暂时无法证实',
};

/** 平票时的优先级：越靠前越优先。 */
const LEVEL_PRIORITY: VerdictLevel[] = [
  'out_of_context',
  'false',
  'partly_true',
  'true',
  'unverified',
];

const ClaimDraftSchema = z.object({
  claimId: z.string(),
  level: VerdictLevelSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  citationIds: z.array(z.string()),
});

const ClaimDraftsSchema = z.object({
  verdicts: z.array(ClaimDraftSchema).default([]),
});

const OverallSchema = z.object({
  headline: z.string().default(''),
  summary: z.string().default(''),
  rebuttalCard: z
    .object({
      title: z.string().default(''),
      body: z.string().default(''),
    })
    .default({ title: '', body: '' }),
});

type ClaimDraft = z.infer<typeof ClaimDraftSchema>;

/** 全局编号：[s1] 对应 sources 里的第 1 条。 */
type Numbering = {
  byId: Map<string, string>;
  byToken: Map<string, string>;
  ordered: Source[];
};

/** 独立证人：同源组只保留首发源。 */
export type Witness = {
  source: Source;
  stance: Stance;
  tier: Tier;
};

type Distortion = {
  detected: boolean;
  headTier: Tier | null;
  mutationCount: number;
};

type RuleVerdict = {
  level: VerdictLevel;
  confidence: number;
};

type ClaimEntry = {
  claim: Claim;
  witnesses: Witness[];
  timeline: TimelineStep[];
  distortion: Distortion;
  rule: RuleVerdict | null;
  conflict?: ClaimConflict;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isAuthoritative(tier: Tier): boolean {
  return tier === 'official' || tier === 'media';
}

function clip(text: string, max: number): string {
  const chars = [...text.trim()];
  if (chars.length <= max) {
    return chars.join('');
  }
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

function charLength(text: string): number {
  return [...text].length;
}

/** 按 sources 数组顺序建立全局编号。 */
function buildNumbering(sources: Source[]): Numbering {
  const byId = new Map<string, string>();
  const byToken = new Map<string, string>();

  sources.forEach((source, index) => {
    const token = `s${index + 1}`;
    byId.set(source.id, token);
    byToken.set(token, source.id);
    byToken.set(source.id, source.id);
  });

  return { byId, byToken, ordered: sources };
}

/** 来源 id → 所属同源组；成员与首发源都能查到。 */
function indexGroups(groups: SourceGroup[]): Map<string, SourceGroup> {
  const bySource = new Map<string, SourceGroup>();

  for (const group of groups) {
    for (const id of [group.originSourceId, ...group.memberIds]) {
      if (!bySource.has(id)) {
        bySource.set(id, group);
      }
    }
  }

  return bySource;
}

/** 时间升序 → tier 降序 → id 字典序，保证代表源稳定。 */
function compareSources(a: Source, b: Source): number {
  const timeA = a.publishedAt ? Date.parse(a.publishedAt) : Number.NaN;
  const timeB = b.publishedAt ? Date.parse(b.publishedAt) : Number.NaN;
  const hasA = Number.isFinite(timeA);
  const hasB = Number.isFinite(timeB);

  if (hasA && hasB && timeA !== timeB) {
    return timeA - timeB;
  }
  if (hasA !== hasB) {
    return hasA ? -1 : 1;
  }

  const tierDiff = TIER_RANK[b.tier ?? 'unknown'] - TIER_RANK[a.tier ?? 'unknown'];
  if (tierDiff !== 0) {
    return tierDiff;
  }
  return a.id.localeCompare(b.id);
}

function compareWitnesses(a: Witness, b: Witness): number {
  const stanceRank = (stance: Stance): number =>
    stance === 'support' || stance === 'refute' ? 0 : 1;
  const rankDiff = stanceRank(a.stance) - stanceRank(b.stance);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  const tierDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
  if (tierDiff !== 0) {
    return tierDiff;
  }
  return compareSources(a.source, b.source);
}

function pickRepresentative(members: Source[], group: SourceGroup | undefined): Source {
  if (group) {
    const origin = members.find((source) => source.id === group.originSourceId);
    if (origin) {
      return origin;
    }
  }
  return [...members].sort(compareSources)[0];
}

/** 每个同源组只取一个独立证人，组内优先首发源。 */
function buildWitnesses(
  claim: Claim,
  sources: Source[],
  groupOf: Map<string, SourceGroup>,
): Witness[] {
  const buckets = new Map<string, { group?: SourceGroup; members: Source[] }>();

  for (const source of sources) {
    if (source.claimId !== claim.id) {
      continue;
    }

    const group = groupOf.get(source.id);
    const key = group ? group.id : `solo:${source.id}`;
    const bucket = buckets.get(key) ?? { group, members: [] };
    bucket.members.push(source);
    buckets.set(key, bucket);
  }

  const witnesses: Witness[] = [];
  for (const bucket of buckets.values()) {
    const source = pickRepresentative(bucket.members, bucket.group);
    witnesses.push({
      source,
      stance: source.stance ?? 'irrelevant',
      tier: source.tier ?? 'unknown',
    });
  }

  return witnesses.sort(compareWitnesses);
}

/** 供验收脚本查看每个疑点真正参与判定的独立首发源。 */
export function collectWitnesses(
  claim: Claim,
  sources: Source[],
  groups: SourceGroup[],
): Witness[] {
  return buildWitnesses(
    claim,
    sources.filter((source) => source.reachable !== false),
    indexGroups(groups),
  );
}

/** HEAD 失败再 GET，5 秒超时，跟随跳转。 */
async function probeUrl(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const response = await fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // HEAD 被拒或超时，换 GET 再试一次
    }
  }
  return false;
}

/** 链接校验：给每条来源补 reachable，同一 URL 只探测一次。 */
export async function checkReachability(sources: Source[]): Promise<Source[]> {
  const urls = [...new Set(sources.map((source) => source.url))];
  const results = new Map<string, boolean>();

  await Promise.all(
    urls.map(async (url) => {
      results.set(url, await probeUrl(url));
    }),
  );

  return sources.map((source) => ({ ...source, reachable: results.get(source.url) ?? false }));
}

/** 时间线首节点是权威来源，且同源后续节点出现传播变形表述时才算走样。 */
function detectDistortion(
  steps: TimelineStep[],
  sourcesById: Map<string, Source>,
  groupOf: Map<string, SourceGroup>,
): Distortion {
  if (steps.length < 2) {
    return { detected: false, headTier: null, mutationCount: 0 };
  }

  const head = sourcesById.get(steps[0].sourceId);
  if (!head) {
    return { detected: false, headTier: null, mutationCount: 0 };
  }

  const headTier = head.tier ?? 'unknown';
  const headGroup = groupOf.get(head.id);
  if (!headGroup || !isAuthoritative(headTier)) {
    return { detected: false, headTier, mutationCount: 0 };
  }

  let mutationCount = 0;
  for (const step of steps.slice(1)) {
    if (!step.mutation || !MUTATION_RE.test(step.mutation)) {
      continue;
    }
    const source = sourcesById.get(step.sourceId);
    if (!source) {
      continue;
    }
    const group = groupOf.get(source.id);
    if (group && group.id === headGroup.id) {
      mutationCount += 1;
    }
  }

  return { detected: mutationCount > 0, headTier, mutationCount };
}

/** 一方里等级最高的 tier。 */
function topTierOf(witnesses: Witness[]): Tier {
  return witnesses.reduce<Tier>(
    (best, witness) => (TIER_RANK[witness.tier] > TIER_RANK[best] ? witness.tier : best),
    'unknown',
  );
}

/** 一方里最新的发布时间（毫秒），没有可用时间时返回 null。 */
function latestTimeOf(witnesses: Witness[]): number | null {
  let latest: number | null = null;
  for (const witness of witnesses) {
    const value = witness.source.publishedAt ? Date.parse(witness.source.publishedAt) : Number.NaN;
    if (Number.isFinite(value) && (latest === null || value > latest)) {
      latest = value;
    }
  }
  return latest;
}

function describeSide(witnesses: Witness[], tier: Tier): string {
  const sites = [
    ...new Set(
      witnesses.filter((witness) => witness.tier === tier).map((witness) => witness.source.site),
    ),
  ].slice(0, 2);
  return `${sites.join('、')}（${TIER_NAMES[tier]}）`;
}

/** 同疑点正反都有独立证人时记录冲突，并给出采信理由。 */
function buildConflict(
  supporters: Witness[],
  refuters: Witness[],
): { conflict: ClaimConflict; undecided: boolean } | undefined {
  if (supporters.length === 0 || refuters.length === 0) {
    return undefined;
  }

  const supportTier = topTierOf(supporters);
  const refuteTier = topTierOf(refuters);
  const supportTime = latestTimeOf(supporters);
  const refuteTime = latestTimeOf(refuters);

  let resolution: string;
  let undecided = false;
  if (TIER_RANK[supportTier] !== TIER_RANK[refuteTier]) {
    resolution =
      TIER_RANK[supportTier] > TIER_RANK[refuteTier]
        ? `采信支持方：${describeSide(supporters, supportTier)}等级高于反驳方的${TIER_NAMES[refuteTier]}`
        : `采信反驳方：${describeSide(refuters, refuteTier)}等级高于支持方的${TIER_NAMES[supportTier]}`;
  } else if (supportTime !== null && refuteTime !== null && supportTime !== refuteTime) {
    resolution =
      refuteTime > supportTime
        ? `双方同属${TIER_NAMES[refuteTier]}，反驳方发布时间更晚，按后续更正采信反驳方`
        : `双方同属${TIER_NAMES[supportTier]}，支持方发布时间更晚，按后续确认采信支持方`;
  } else {
    undecided = true;
    resolution = `双方同属${TIER_NAMES[refuteTier]}且发布时间没有明确先后，无法判断，按无法证实处理`;
  }

  return {
    conflict: {
      supportIds: supporters.map((witness) => witness.source.id),
      refuteIds: refuters.map((witness) => witness.source.id),
      resolution,
    },
    undecided,
  };
}

/** 规则引擎：证据不足一律 unverified，规则优先于模型直觉。 */
function judgeByRules(witnesses: Witness[], distortion: Distortion): RuleVerdict | null {
  const active = witnesses.filter((witness) => witness.stance !== 'irrelevant');
  if (active.length === 0) {
    return { level: 'unverified', confidence: 0.12 };
  }

  const supporters = active.filter((witness) => witness.stance === 'support');
  const refuters = active.filter((witness) => witness.stance === 'refute');
  const authSupporters = supporters.filter((witness) => isAuthoritative(witness.tier)).length;
  const authRefuters = refuters.filter((witness) => isAuthoritative(witness.tier)).length;

  // 权威来源明确反驳，且没有权威来源支持 → 谣言
  if (authRefuters > 0 && authSupporters === 0) {
    const confidence = Math.min(
      0.97,
      0.9 +
        0.02 * Math.max(0, authRefuters - 1) +
        0.02 * Math.max(0, refuters.length - authRefuters),
    );
    return { level: 'false', confidence: round2(confidence) };
  }

  // 支持方全部来自营销号 → 谣言
  if (supporters.length > 0 && supporters.every((witness) => witness.tier === 'marketing')) {
    return { level: 'false', confidence: 0.8 };
  }

  // 原始来源存在，但传播中途走样 → 断章取义
  if (distortion.detected && supporters.length >= 1) {
    const confidence = Math.min(
      0.93,
      0.8 +
        0.02 * Math.min(distortion.mutationCount, 2) +
        (distortion.headTier === 'official' ? 0.02 : 0),
    );
    return { level: 'out_of_context', confidence: round2(confidence) };
  }

  // 多个独立证人支持，且有权威来源，无反方 → 属实
  if (supporters.length >= 2 && authSupporters >= 1 && authRefuters === 0) {
    const confidence = Math.min(
      0.92,
      0.75 + 0.04 * (supporters.length - 2) + 0.03 * (authSupporters - 1),
    );
    return { level: 'true', confidence: round2(confidence) };
  }

  // 权威来源两边都有 → 部分属实
  if (authSupporters > 0 && authRefuters > 0) {
    return { level: 'partly_true', confidence: 0.62 };
  }

  // 独立证人不足 → 无法证实
  if (active.length < 2) {
    return { level: 'unverified', confidence: round2(0.2 + 0.06 * active.length) };
  }

  // 没有权威来源支持 → 无法证实
  if (authSupporters === 0) {
    return {
      level: 'unverified',
      confidence: round2(Math.min(0.45, 0.3 + 0.06 * (active.length - 1))),
    };
  }

  return null;
}

function describeWitness(witness: Witness, numbering: Numbering): string {
  const token = numbering.byId.get(witness.source.id) ?? witness.source.id;
  return [
    `- [${token}]`,
    `来源 id: ${witness.source.id}`,
    `立场: ${witness.stance}`,
    `可信度: ${witness.tier}`,
    `站点: ${witness.source.site}`,
    `标题: ${clip(witness.source.title, 60)}`,
    `摘要: ${clip(witness.source.snippet, 160)}`,
  ].join(' | ');
}

function describeTimeline(
  steps: TimelineStep[],
  sourcesById: Map<string, Source>,
  numbering: Numbering,
): string {
  if (steps.length === 0) {
    return '（没有可用的变形时间线）';
  }

  return steps
    .map((step, index) => {
      const source = sourcesById.get(step.sourceId);
      const token = numbering.byId.get(step.sourceId) ?? step.sourceId;
      const mutation = step.mutation ? `；走样：${clip(step.mutation, 60)}` : '';
      return `${index + 1}. [${token}] ${source?.site ?? '未知站点'}「${clip(step.quote, 80)}」${mutation}`;
    })
    .join('\n');
}

function describeClaim(
  entry: ClaimEntry,
  numbering: Numbering,
  sourcesById: Map<string, Source>,
): string {
  const ranked = entry.witnesses.slice(0, MAX_WITNESSES_PER_CLAIM);
  const rows = ranked.map((witness) => describeWitness(witness, numbering)).join('\n');
  const ruleLine = entry.rule
    ? `规则引擎预判：${entry.rule.level}（置信度 ${entry.rule.confidence}，最终以此为准）`
    : '规则引擎预判：无（请在 partly_true / out_of_context / unverified 中选择）';

  return [
    `【疑点 ${entry.claim.id}】${entry.claim.text}`,
    ruleLine,
    `独立证人（每个同源组只取首发源，共 ${ranked.length} 个）：`,
    rows || '（没有找到可用来源）',
    '变形时间线：',
    describeTimeline(entry.timeline, sourcesById, numbering),
  ].join('\n');
}

function buildClaimPrompt(
  entries: ClaimEntry[],
  numbering: Numbering,
  sourcesById: Map<string, Source>,
): string {
  const sections = entries
    .map((entry) => describeClaim(entry, numbering, sourcesById))
    .join('\n\n');

  return `你是「AI 侦探社」的终审法官，正在为一条待核查消息逐条给出判决。

判决只能从以下五档中选择：
- true（属实）：至少 2 个独立证人支持，其中至少 1 个是官方或权威媒体，且没有高等级反驳。
- false（谣言）：有官方或权威媒体明确反驳；或支持方全部来自同一个营销号源头。
- out_of_context（断章取义）：原始来源存在，但传播中被夸大、删去前提或偷换概念，时间线出现明显走样。
- partly_true（部分属实）：部分要素属实，部分不实或明显夸大。
- unverified（无法证实）：独立证人不足 2 个，或证据互相矛盾且没有权威来源。

硬性规则（优先于你的直觉）：
1. 同一同源组只算一个独立证人，下面已经为你合并好。
2. 证据不足时必须判 unverified，不要为了给出结论而猜测。
3. 如果给出了「规则引擎预判」，你的 level 必须与之一致，summary 只需解释该结论。
4. summary 用 2-4 句中文，每个关键结论句末尾用 [s编号] 标注出处，编号只能使用下面出现过的；不得编造来源。
5. citationIds 列出 summary 中实际用到的来源真实 id（如 src_xxx）。
6. confidence 是 0-1 的小数，表示对该档判决的把握。

${sections}

只输出如下格式的 JSON 对象，不要 Markdown、注释或解释：
{"verdicts":[{"claimId":"c1","level":"out_of_context","confidence":0.84,"summary":"……[s1]","citationIds":["src_xxx"]}]}`;
}

async function requestClaimDrafts(
  input: string,
  entries: ClaimEntry[],
  numbering: Numbering,
  sourcesById: Map<string, Source>,
): Promise<Map<string, ClaimDraft>> {
  if (entries.length === 0) {
    return new Map();
  }

  try {
    const result = await chatJSON({
      system: buildClaimPrompt(entries, numbering, sourcesById),
      user: `待核查原文：${input}\n\n请对以上 ${entries.length} 个疑点逐一判决。`,
      schema: ClaimDraftsSchema,
      temperature: TEMPERATURE,
      timeoutMs: TIMEOUT_MS,
    });

    const valid = new Set(entries.map((entry) => entry.claim.id));
    const drafts = new Map<string, ClaimDraft>();
    for (const draft of result.verdicts) {
      if (valid.has(draft.claimId)) {
        drafts.set(draft.claimId, draft);
      }
    }
    return drafts;
  } catch (error) {
    console.warn(`[verdict] 疑点判决生成失败，改用规则文案：${(error as Error).message}`);
    return new Map();
  }
}

function buildOverallPrompt(
  input: string,
  claims: Claim[],
  claimVerdicts: ClaimVerdict[],
  numbering: Numbering,
): string {
  const rows = claimVerdicts
    .map((item, index) => {
      const claim = claims.find((candidate) => candidate.id === item.claimId);
      return [
        `${index + 1}. 疑点 ${item.claimId}：${claim?.text ?? ''}`,
        `   判决：${item.level}（置信度 ${item.confidence}）`,
        `   结论：${item.summary}`,
      ].join('\n');
    })
    .join('\n');

  const sourceList =
    numbering.ordered
      .map((source) => `[${numbering.byId.get(source.id)}] ${source.site}｜${source.title}`)
      .join('\n') || '（无可用来源）';

  return `你是「AI 侦探社」的主编，请根据下面的疑点判决写整案结论与一张家族群辟谣卡。

原始消息：${input}

疑点判决：
${rows}

可用来源编号：
${sourceList}

要求：
- headline：12 字以内的大字结论，直接给结论，可用「断章取义：原研究只说可能有关」这种短句；
- summary：3-5 句中文，先给结论再给依据，不要逐条复述疑点；引用来源时在句末用 [s编号]；
- rebuttalCard.title：不超过 16 字，像家族群里的一句提醒；
- rebuttalCard.body：不超过 80 字，语气亲切、口语化，结尾必须是「来源：xxx」，不要使用 Markdown；
- 只引用上面出现过的编号，不得编造来源。

只输出如下格式的 JSON 对象，不要 Markdown、注释或解释：
{"headline":"……","summary":"……","rebuttalCard":{"title":"……","body":"……来源：xxx"}}`;
}

async function requestOverall(
  input: string,
  claims: Claim[],
  claimVerdicts: ClaimVerdict[],
  numbering: Numbering,
): Promise<z.infer<typeof OverallSchema> | null> {
  try {
    return await chatJSON({
      system: buildOverallPrompt(input, claims, claimVerdicts, numbering),
      user: `请根据以上 ${claimVerdicts.length} 个疑点判决，写出整案结论与辟谣卡。`,
      schema: OverallSchema,
      temperature: TEMPERATURE,
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    console.warn(`[verdict] 整案结论生成失败，改用规则文案：${(error as Error).message}`);
    return null;
  }
}

function decideLevel(rule: RuleVerdict | null, draft: ClaimDraft | undefined): RuleVerdict {
  if (rule) {
    return rule;
  }
  if (!draft) {
    return { level: 'unverified', confidence: 0.3 };
  }
  if (
    draft.level === 'partly_true' ||
    draft.level === 'out_of_context' ||
    draft.level === 'unverified'
  ) {
    return { level: draft.level, confidence: round2(Math.min(draft.confidence, 0.72)) };
  }
  // 规则未放行时，模型不能单独把结论推向 true / false
  return { level: 'unverified', confidence: round2(Math.min(draft.confidence, 0.45)) };
}

/** 删除摘要里不存在或来源不可达的引用编号，并把真实 id 规范成 [s编号]。 */
function sanitizeSummary(
  raw: string,
  numbering: Numbering,
  usableIds: Set<string>,
): { summary: string; used: Set<string> } {
  const used = new Set<string>();
  const normalized = raw.replace(/【/g, '[').replace(/】/g, ']');

  const summary = normalized
    .replace(CITATION_RE, (_match: string, token: string) => {
      const trimmed = token.trim().slice(0, MAX_CITATION_TOKEN_CHARS);
      const sourceId = numbering.byToken.get(trimmed);
      if (!sourceId || !usableIds.has(sourceId)) {
        return '';
      }
      used.add(sourceId);
      return `[${numbering.byId.get(sourceId) ?? trimmed}]`;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。！？；：、])/g, '$1')
    .replace(/([，。！？；：、])\1+/g, '$1')
    .replace(/^[\s，。；：、]+/, '')
    .trim();

  return { summary, used };
}

/** citationIds 只保留摘要里真正出现过的来源，保证两者双向一致。 */
function collectCitationIds(used: Set<string>, numbering: Numbering): string[] {
  return numbering.ordered.filter((source) => used.has(source.id)).map((source) => source.id);
}

function preferredWitnesses(level: VerdictLevel, witnesses: Witness[]): Witness[] {
  const active = witnesses.filter((witness) => witness.stance !== 'irrelevant');
  const wanted: Stance = level === 'false' ? 'refute' : 'support';

  return [...active].sort((a, b) => {
    const matchDiff = (a.stance === wanted ? 0 : 1) - (b.stance === wanted ? 0 : 1);
    if (matchDiff !== 0) {
      return matchDiff;
    }
    return TIER_RANK[b.tier] - TIER_RANK[a.tier];
  });
}

function fallbackSummary(
  claim: Claim,
  level: VerdictLevel,
  witnesses: Witness[],
  numbering: Numbering,
): { summary: string; used: Set<string> } {
  const used = new Set<string>();
  const marks = preferredWitnesses(level, witnesses)
    .slice(0, 2)
    .map((witness) => {
      const token = numbering.byId.get(witness.source.id);
      if (!token) {
        return '';
      }
      used.add(witness.source.id);
      return `[${token}]`;
    })
    .filter(Boolean)
    .join('');

  const head = claim.text.replace(/[。！？!?；;，,]+$/, '');
  return {
    summary: `${head}：${fallbackTail(level, witnesses)}${marks ? ` ${marks}` : ''}。`,
    used,
  };
}

/** 同为“谣言”，权威反驳与营销号互转要用不同说法。 */
function fallbackTail(level: VerdictLevel, witnesses: Witness[]): string {
  if (level === 'false') {
    const supporters = witnesses.filter((witness) => witness.stance === 'support');
    if (supporters.length > 0 && supporters.every((witness) => witness.tier === 'marketing')) {
      return '支持该说法的来源全部出自营销号，没有可信来源支撑';
    }
  }
  if (level === 'unverified') {
    const hasSupport = witnesses.some((witness) => witness.stance === 'support');
    const hasRefute = witnesses.some((witness) => witness.stance === 'refute');
    if (hasSupport && hasRefute) {
      return '来源之间互相矛盾，又没有更权威的依据，暂时无法证实';
    }
  }
  return LEVEL_TAILS[level];
}

function buildClaimSummary(
  entry: ClaimEntry,
  level: VerdictLevel,
  draft: ClaimDraft | undefined,
  numbering: Numbering,
  usableIds: Set<string>,
): { summary: string; citationIds: string[] } {
  // 冲突未决时必须如实说明矛盾，不能再让模型自由发挥
  const mustExplainConflict = entry.conflict !== undefined && level === 'unverified';
  if (!mustExplainConflict) {
    const sanitized = sanitizeSummary(draft?.summary ?? '', numbering, usableIds);
    if (sanitized.summary) {
      return {
        summary: sanitized.summary,
        citationIds: collectCitationIds(sanitized.used, numbering),
      };
    }
  }

  const fallback = fallbackSummary(entry.claim, level, entry.witnesses, numbering);
  return {
    summary: fallback.summary,
    citationIds: collectCitationIds(fallback.used, numbering),
  };
}

function finalizeClaim(
  entry: ClaimEntry,
  draft: ClaimDraft | undefined,
  numbering: Numbering,
  usableIds: Set<string>,
): ClaimVerdict {
  const { level, confidence } = decideLevel(entry.rule, draft);
  const { summary, citationIds } = buildClaimSummary(entry, level, draft, numbering, usableIds);

  return {
    claimId: entry.claim.id,
    level,
    confidence,
    summary,
    citationIds,
    ...(entry.conflict ? { conflict: entry.conflict } : {}),
  };
}

function aggregateVerdicts(items: ClaimVerdict[]): { level: VerdictLevel; confidence: number } {
  if (items.length === 0) {
    return { level: 'unverified', confidence: 0.1 };
  }

  // 核心疑点（第一条）权重加倍
  const weights = items.map((_, index) => (index === 0 ? 2 : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const scores = new Map<VerdictLevel, number>();

  items.forEach((item, index) => {
    scores.set(item.level, (scores.get(item.level) ?? 0) + weights[index]);
  });

  let level: VerdictLevel | undefined;
  for (const [candidate, score] of scores) {
    if (score * 2 > total) {
      level = candidate;
      break;
    }
  }
  if (!level) {
    level = LEVEL_PRIORITY.find((candidate) => scores.has(candidate)) ?? 'unverified';
  }

  const weighted = items.reduce((sum, item, index) => sum + item.confidence * weights[index], 0);
  return { level, confidence: round2(weighted / total) };
}

function fallbackOverallSummary(claimVerdicts: ClaimVerdict[], level: VerdictLevel): string {
  if (claimVerdicts.length === 0) {
    return '这条消息里没有找到可以核查的具体事实。';
  }
  const detail = claimVerdicts
    .map((item) => `疑点 ${item.claimId} 判为${LEVEL_NAMES[item.level]}`)
    .join('，');
  return `整案判为${LEVEL_NAMES[level]}：${detail}。`;
}

function fitHeadline(raw: string | undefined, level: VerdictLevel): string {
  const text = (raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[。；;]+$/, '')
    .trim();

  if (text && charLength(text) <= MAX_HEADLINE_CHARS) {
    return text;
  }
  return FALLBACK_HEADLINES[level];
}

function fitTitle(raw: string | undefined, level: VerdictLevel): string {
  const text = (raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return FALLBACK_TITLES[level];
  }
  if (charLength(text) <= MAX_TITLE_CHARS) {
    return text;
  }
  return `${[...text].slice(0, MAX_TITLE_CHARS - 1).join('')}…`;
}

function buildSourceTail(sites: string[]): string {
  const unique = [...new Set(sites.filter((site) => site.trim().length > 0))];

  if (unique.length === 0) {
    return '来源：公开资料';
  }

  const pair = `来源：${unique.slice(0, 2).join('、')}`;
  if (charLength(pair) <= MAX_SOURCE_TAIL_CHARS) {
    return pair;
  }

  const single = `来源：${unique[0]}`;
  if (charLength(single) <= MAX_SOURCE_TAIL_CHARS) {
    return single;
  }

  return '来源：公开资料';
}

function stripSourceTail(text: string): string {
  return text.replace(/来源[:：][\s\S]*$/, '').replace(/\[[^\]]*\]/g, '');
}

/** 正文控制在 80 字内，并强制以「来源：xxx」结尾。 */
function composeBody(raw: string | undefined, sites: string[], fallback: string): string {
  const cleaned = stripSourceTail(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s，。；：、]+/, '')
    .trim();
  const base = cleaned || fallback;
  const tail = buildSourceTail(sites);

  const needsStop = !/[。！？!?…]$/.test(base);
  const budget = Math.max(0, MAX_BODY_CHARS - charLength(tail) - (needsStop ? 1 : 0));
  const chars = [...base];
  let body = chars.length <= budget ? base : `${chars.slice(0, Math.max(0, budget - 1)).join('')}…`;

  if (needsStop && !/[。！？!?…]$/.test(body)) {
    body = `${body}。`;
  }

  return `${body}${tail}`;
}

/** 辟谣卡来源：优先用判决引用到的权威站点，不足时退回案内权威站点。 */
function pickSites(cited: Set<string>, sourcesById: Map<string, Source>, all: Source[]): string[] {
  const citedSources = [...cited]
    .map((id) => sourcesById.get(id))
    .filter((source): source is Source => source !== undefined);

  const citedAuthoritative = citedSources.filter((source) =>
    isAuthoritative(source.tier ?? 'unknown'),
  );
  const allAuthoritative = all.filter((source) => isAuthoritative(source.tier ?? 'unknown'));

  let pool = citedSources;
  if (citedAuthoritative.length > 0) {
    pool = citedAuthoritative;
  } else if (allAuthoritative.length > 0) {
    pool = allAuthoritative;
  }

  const ranked = [...pool].sort(
    (a, b) => TIER_RANK[b.tier ?? 'unknown'] - TIER_RANK[a.tier ?? 'unknown'],
  );

  const sites: string[] = [];
  for (const source of ranked) {
    if (sites.length >= 2) {
      break;
    }
    if (!source.site || sites.includes(source.site)) {
      continue;
    }
    sites.push(source.site);
  }

  return sites;
}

function buildEmptyVerdict(): Verdict {
  return VerdictSchema.parse({
    level: 'unverified',
    confidence: 0.1,
    evidenceState: 'none',
    headline: NO_EVIDENCE_HEADLINE,
    summary: '这条消息里没有找到可以核查的具体事实，也没有可用的检索词和来源，所以无法确认。',
    claims: [],
    rebuttalCard: {
      title: FALLBACK_TITLES.unverified,
      body: composeBody(undefined, [], FALLBACK_BODIES.unverified),
    },
  });
}

/** 全案独立证人（去重）：≥2 多源，1 单一来源，0 无来源。 */
function computeEvidenceState(entries: ClaimEntry[]): EvidenceState {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const witness of entry.witnesses) {
      if (witness.stance !== 'irrelevant') {
        ids.add(witness.source.id);
      }
    }
  }
  if (ids.size >= 2) {
    return 'multi';
  }
  return ids.size === 1 ? 'single' : 'none';
}

/** 零证人时如实交代查过什么、看了多少、为什么确认不了。 */
function buildNoEvidenceSummary(claims: Claim[], sources: Source[]): string {
  const queries = [...new Set(sources.map((source) => source.query.trim()).filter(Boolean))];
  const queryText = queries.length
    ? queries.map((query) => `「${clip(query, 24)}」`).join('、')
    : '（没有可用的检索词）';
  const claimText = claims.map((claim) => `「${clip(claim.text, 30)}」`).join('、');

  if (sources.length === 0) {
    return `我按${queryText}检索后没有取到任何来源，围绕${claimText}没有任何可核对的证据，所以无法确认这条消息的真假。`;
  }

  const unreachable = sources.filter((source) => source.reachable === false).length;
  const reachText = unreachable > 0 ? `其中 ${unreachable} 条链接打不开` : '链接都能打开';
  return `我查了${queryText}这些检索词，看了 ${sources.length} 条来源（${reachText}），围绕${claimText}没有找到能直接支撑或反驳的独立来源，所以无法确认这条消息的真假。`;
}

/**
 * 判决：逐疑点出结论，再综合成整案判决与辟谣卡。
 * 模型失败只降级文案，不抛错；引用编号以 sources 顺序为准。
 */
export async function makeVerdict(
  input: string,
  claims: Claim[],
  sources: Source[],
  groups: SourceGroup[],
  timelines: Record<string, TimelineStep[]>,
): Promise<Verdict> {
  if (claims.length === 0) {
    return buildEmptyVerdict();
  }

  // 先校验链接：不可达的来源不参与判决，也不允许被引用
  const checked = await checkReachability(sources);
  const reachableById = new Map(checked.map((source) => [source.id, source.reachable === true]));
  for (const source of sources) {
    source.reachable = reachableById.get(source.id) ?? false;
  }
  const usable = checked.filter((source) => source.reachable === true);
  const usableIds = new Set(usable.map((source) => source.id));

  const numbering = buildNumbering(checked);
  const sourcesById = new Map(checked.map((source) => [source.id, source]));
  const groupOf = indexGroups(groups);

  const entries: ClaimEntry[] = claims.map((claim) => {
    const witnesses = buildWitnesses(claim, usable, groupOf);
    const timeline = timelines[claim.id] ?? [];
    const distortion = detectDistortion(timeline, sourcesById, groupOf);
    const supporters = witnesses.filter((witness) => witness.stance === 'support');
    const refuters = witnesses.filter((witness) => witness.stance === 'refute');
    const conflict = buildConflict(supporters, refuters);
    const rule = judgeByRules(witnesses, distortion);
    const undecided = conflict?.undecided === true;

    return {
      claim,
      witnesses,
      timeline,
      distortion,
      conflict: conflict?.conflict,
      // 正反双方分不出高下时，任何一方都不能单独定案
      rule: undecided
        ? { level: 'unverified', confidence: round2(Math.min(rule?.confidence ?? 0.3, 0.45)) }
        : rule,
    };
  });

  const drafts = await requestClaimDrafts(input, entries, numbering, sourcesById);
  const claimVerdicts = entries.map((entry) =>
    finalizeClaim(entry, drafts.get(entry.claim.id), numbering, usableIds),
  );

  const aggregate = aggregateVerdicts(claimVerdicts);
  const overall = await requestOverall(input, claims, claimVerdicts, numbering);

  const summaryResult = sanitizeSummary(overall?.summary ?? '', numbering, usableIds);
  const evidenceState = computeEvidenceState(entries);

  let level: VerdictLevel = aggregate.level;
  let confidence = aggregate.confidence;
  let headline: string;
  let summary = summaryResult.summary || fallbackOverallSummary(claimVerdicts, level);

  if (evidenceState === 'none') {
    level = 'unverified';
    confidence = round2(Math.min(confidence, 0.1));
    headline = NO_EVIDENCE_HEADLINE;
    summary = buildNoEvidenceSummary(claims, checked);
  } else if (evidenceState === 'single') {
    headline = SINGLE_HEADLINE;
    confidence = round2(Math.min(confidence, SINGLE_CONFIDENCE_CAP));
    summary = `${SINGLE_HEADLINE}，暂无法交叉印证，结论只能按${LEVEL_NAMES[level]}处理。${summary}`;
  } else {
    headline = fitHeadline(overall?.headline, level);
  }

  const cited = new Set<string>(summaryResult.used);
  for (const item of claimVerdicts) {
    for (const id of item.citationIds) {
      cited.add(id);
    }
  }
  const sites = pickSites(cited, sourcesById, usable);

  return VerdictSchema.parse({
    level,
    confidence,
    evidenceState,
    headline,
    summary,
    claims: claimVerdicts,
    rebuttalCard: {
      title: fitTitle(overall?.rebuttalCard.title, level),
      body: composeBody(overall?.rebuttalCard.body, sites, FALLBACK_BODIES[level]),
    },
  });
}

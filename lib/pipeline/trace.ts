/**
 * 流水线第五步：溯源变形时间线。
 * 先补齐关键来源的发布时间，再从每个同源组的首发源中挑选节点，
 * 让大模型为节点摘录原句并描述相对上一节点的走样。
 */
import { load } from 'cheerio';
import pLimit from 'p-limit';
import { z } from 'zod';
import {
  TimelineStepSchema,
  type CaseEvent,
  type Claim,
  type Source,
  type SourceGroup,
  type Tier,
  type TimelineStep,
} from '../../types/case';
import { chatJSON } from '../llm';

/** 单页面抓取超时 */
const FETCH_TIMEOUT_MS = 5_000;
/** 每个疑点最多补抓的来源数 */
const MAX_FETCH_PER_CLAIM = 10;
/** 抓取并发上限，避免一次打开过多连接 */
const FETCH_CONCURRENCY = 5;
/** 时间线最多节点数 */
const MAX_NODES = 5;
/** 正文扫描范围 */
const BODY_SCAN_CHARS = 3_000;
/** 少于两个节点时不生成时间线 */
const MIN_NODES = 2;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const META_SELECTORS = [
  'meta[property="article:published_time"]',
  'meta[name="pubdate"]',
  'meta[itemprop="datePublished"]',
];

/** 正文里的日期格式：YYYY-MM-DD、YYYY/M/D、YYYY年M月D日 */
const BODY_DATE_RE = /(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?/;

/** 带时区的 ISO 时间，直接交给 Date 解析以保留原时区 */
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i;

const TimelineDraftSchema = z.object({
  steps: z.array(
    z.object({
      sourceId: z.string(),
      quote: z.string().trim().min(1),
      mutation: z.string().optional(),
    }),
  ),
});

type TimelineDraft = z.infer<typeof TimelineDraftSchema>;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 统一按东八区解释缺失时区的时间。 */
function toIsoDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): string | undefined {
  if (year < 1900 || year > 2100) return undefined;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return undefined;

  const date = new Date(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`,
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 把元信息里的日期转成 ISO 8601；无法识别时返回 undefined。 */
function parseDateValue(raw: string | undefined): string | undefined {
  const text = raw?.trim();
  if (!text) return undefined;

  if (ISO_WITH_ZONE_RE.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  const match = text.match(
    /(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?(?:[T\s]*(\d{1,2})[:：](\d{1,2})(?:[:：](\d{1,2}))?)?/,
  );
  if (!match) return undefined;

  return toIsoDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
}

/** 在 JSON-LD 结构里递归找 datePublished。 */
function findJsonLdDate(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonLdDate(item);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.datePublished === 'string') {
    return record.datePublished;
  }

  for (const child of Object.values(record)) {
    const found = findJsonLdDate(child);
    if (found) return found;
  }
  return undefined;
}

/** 按约定顺序从页面中提取发布时间。 */
function extractPublishedAt(html: string): string | undefined {
  const $ = load(html);

  for (const selector of META_SELECTORS) {
    const iso = parseDateValue($(selector).first().attr('content'));
    if (iso) return iso;
  }

  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const text = $(element).text().trim();
    if (!text) continue;

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }

    const iso = parseDateValue(findJsonLdDate(data));
    if (iso) return iso;
  }

  $('script, style, noscript').remove();
  const body = ($('body').text() || $.root().text()).replace(/\s+/g, ' ');
  const match = body.slice(0, BODY_SCAN_CHARS).match(BODY_DATE_RE);
  if (!match) return undefined;

  return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** 抓取单个网页的发布时间；失败时静默返回 undefined。 */
async function fetchPublishedAt(url: string): Promise<string | undefined> {
  if (!/^https?:\/\//i.test(url)) {
    return undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    });

    if (!response.ok) {
      return undefined;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/html|xml/i.test(contentType)) {
      return undefined;
    }

    return extractPublishedAt(await response.text());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** 为缺时间的 support/refute 来源补发布时间，每个疑点最多抓 10 条。 */
async function fillPublishedDates(
  claims: Claim[],
  sources: Source[],
  emit: (event: CaseEvent) => void,
): Promise<void> {
  const limit = pLimit(FETCH_CONCURRENCY);
  const tasks: Promise<void>[] = [];

  for (const claim of claims) {
    const pending = sources
      .filter(
        (source) =>
          source.claimId === claim.id &&
          !source.publishedAt &&
          (source.stance === 'support' || source.stance === 'refute'),
      )
      .slice(0, MAX_FETCH_PER_CLAIM);

    for (const source of pending) {
      tasks.push(
        limit(async () => {
          const publishedAt = await fetchPublishedAt(source.url);
          if (!publishedAt) return;

          // 原地补齐，供后续判决与卷宗直接复用
          source.publishedAt = publishedAt;
          emit({ type: 'source_update', id: source.id, patch: { publishedAt } });
        }),
      );
    }
  }

  await Promise.all(tasks);
}

function parseTime(value: string | undefined): number {
  return value ? Date.parse(value) : NaN;
}

/** 每个同源组取首发源，按时间升序截断，并优先覆盖不同 tier。 */
function selectTimelineNodes(claim: Claim, sources: Source[], groups: SourceGroup[]): Source[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  const candidates: Source[] = [];

  for (const group of groups) {
    if (group.claimId !== claim.id || seen.has(group.originSourceId)) continue;
    seen.add(group.originSourceId);

    const source = byId.get(group.originSourceId);
    if (!source) continue;
    if (source.stance !== 'support' && source.stance !== 'refute') continue;
    if (!Number.isFinite(parseTime(source.publishedAt))) continue;

    candidates.push(source);
  }

  candidates.sort((a, b) => parseTime(a.publishedAt) - parseTime(b.publishedAt));
  if (candidates.length <= MAX_NODES) {
    return candidates;
  }

  const selected: Source[] = [];
  const selectedIds = new Set<string>();
  const tiers = new Set<Tier>();

  // 先按时间顺序各取一个 tier，保证节点覆盖不同可信度来源
  for (const source of candidates) {
    if (selected.length >= MAX_NODES) break;
    const tier = source.tier ?? 'unknown';
    if (tiers.has(tier)) continue;
    tiers.add(tier);
    selected.push(source);
    selectedIds.add(source.id);
  }

  for (const source of candidates) {
    if (selected.length >= MAX_NODES) break;
    if (selectedIds.has(source.id)) continue;
    selected.push(source);
    selectedIds.add(source.id);
  }

  return selected.sort((a, b) => parseTime(a.publishedAt) - parseTime(b.publishedAt));
}

function buildTimelinePrompt(claim: Claim, nodes: Source[], groupIds: Map<string, string>): string {
  const rows = nodes
    .map((source, index) => {
      const prev = index > 0 ? nodes[index - 1] : undefined;
      const groupId = groupIds.get(source.id);
      const sameAsPrev =
        prev !== undefined && groupId !== undefined && groupId === groupIds.get(prev.id);

      return [
        `第 ${index + 1} 个节点`,
        `sourceId: ${source.id}`,
        `publishedAt: ${source.publishedAt ?? ''}`,
        `groupId: ${groupId ?? '未知'}`,
        `与上一节点同组: ${prev ? (sameAsPrev ? '是' : '否') : '无上一节点'}`,
        `site: ${source.site}`,
        `title: ${source.title}`,
        `snippet: ${source.snippet}`,
      ].join('\n');
    })
    .join('\n\n');

  return `你是事实核查编辑，正在还原一个说法的传播走样过程。

疑点：${claim.text}

节点（按发布时间升序）：
${rows}

要求：
1. 为每个节点提取一句 quote：从该节点的 snippet 中原样摘录最能代表其说法的连续文字，不得改写、拼接、概括或编造；整句不合适时可截取片段。
2. 为每个节点写 mutation：一句话描述它与上一节点在说法上的关系或变化，只陈述变化，不评价真假，不超过 40 字。
   - 只有「与上一节点同组」为“是”（存在明确转载、摘编关系）时，才可使用「夸大」「删去剂量前提」「嫁接权威机构名义」等传播变形表述；
   - 为“否”时视为独立信源，使用「后续补充」「独立反驳」「讨论对象转移」「换了新数据」等中性表述，不得写成上一来源「变成」「改为」「删去」了本节点的说法。
3. 第一个节点的 mutation 留空字符串。
4. 必须覆盖全部 ${nodes.length} 个节点，sourceId 原样返回，顺序不变。

只输出如下格式的 JSON 对象，不要 Markdown、注释或解释：
{"steps":[{"sourceId":"来源 id","quote":"原文摘录","mutation":"相对上一节点的关系或变化"}]}`;
}

/** 建立时间线节点到同源组的映射，用于判断相邻节点是否存在明确传播关系。 */
function collectGroupIds(
  claim: Claim,
  nodes: Source[],
  groups: SourceGroup[],
): Map<string, string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const groupIds = new Map<string, string>();

  for (const group of groups) {
    if (group.claimId !== claim.id || !nodeIds.has(group.originSourceId)) continue;
    groupIds.set(group.originSourceId, group.id);
  }

  return groupIds;
}

/** 调用一次模型；失败时降级为直接摘录摘要。 */
async function requestQuotes(
  claim: Claim,
  nodes: Source[],
  groupIds: Map<string, string>,
  emit: (event: CaseEvent) => void,
): Promise<TimelineDraft | null> {
  try {
    return await chatJSON({
      system: buildTimelinePrompt(claim, nodes, groupIds),
      user: `请为以上 ${nodes.length} 个节点提取 quote 并描述 mutation。`,
      schema: TimelineDraftSchema,
      temperature: 0,
      timeoutMs: 60_000,
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    emit({
      type: 'error',
      message: `疑点 ${claim.id} 时间线生成失败：${(error as Error).message}${detail ? `（${detail}）` : ''}`,
      recoverable: true,
    });
    return null;
  }
}

/** 模型没给出可用原句时的兜底：直接摘摘要首句。 */
function fallbackQuote(source: Source): string {
  const snippet = source.snippet.trim();
  if (!snippet) {
    return source.title.trim();
  }

  const sentence = snippet.match(/^[^。！？!?\n]{1,120}[。！？!?]?/);
  return (sentence?.[0] ?? snippet.slice(0, 120)).trim();
}

/** quote 必须是摘要中的连续子串，否则退回摘要首句。 */
function normalizeQuote(source: Source, candidate: string | undefined): string {
  const quote = candidate?.trim();
  if (quote && source.snippet.includes(quote)) {
    return quote;
  }
  return fallbackQuote(source);
}

function buildSteps(nodes: Source[], draft: TimelineDraft | null): TimelineStep[] {
  const byId = new Map((draft?.steps ?? []).map((step) => [step.sourceId, step]));

  return nodes.map((source, index) => {
    const item = byId.get(source.id);
    const mutation = index === 0 ? undefined : item?.mutation?.trim() || undefined;

    return TimelineStepSchema.parse({
      sourceId: source.id,
      publishedAt: source.publishedAt,
      quote: normalizeQuote(source, item?.quote),
      mutation,
    });
  });
}

/**
 * 还原每个疑点的变形时间线：补时间 → 选节点 → 模型摘句与描述走样 → 推送事件。
 * 节点不足两个时返回空数组，不抛错。
 */
export async function traceTimeline(
  claims: Claim[],
  sources: Source[],
  groups: SourceGroup[],
  emit: (event: CaseEvent) => void,
): Promise<Record<string, TimelineStep[]>> {
  await fillPublishedDates(claims, sources, emit);

  const timelines: Record<string, TimelineStep[]> = {};

  for (const claim of claims) {
    const nodes = selectTimelineNodes(claim, sources, groups);
    const groupIds = collectGroupIds(claim, nodes, groups);
    const steps =
      nodes.length < MIN_NODES
        ? []
        : buildSteps(nodes, await requestQuotes(claim, nodes, groupIds, emit));

    timelines[claim.id] = steps;
    emit({ type: 'timeline', claimId: claim.id, steps });
  }

  return timelines;
}

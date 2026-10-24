/**
 * 流水线总装：拆疑点预览、立案查证、阶段播报、容错降级、计费结算与落盘。
 * 所有事件都先过 CaseEventSchema 再推送；单个阶段失败降级继续，不中断整案。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CaseEventSchema,
  CaseFileSchema,
  ClaimsPreviewSchema,
  type Billing,
  type CaseEvent,
  type CaseFile,
  type Claim,
  type ClaimsPreview,
  type InputType,
  type Mode,
  type Source,
  type SourceGroup,
  type Stage,
  type Stats,
  type TimelineStep,
  type Verdict,
  type VerdictLevel,
} from '../../types/case';
import { llmStats } from '../llm';
import { searchStats } from '../yuanbao';
import { extractClaims, extractClaimsWithQueries } from './claims';
import { gatherEvidence, getExecutedSearchPlan } from './search';
import { gradeSources } from './grade';
import { clusterSources, countIndependent } from './cluster';
import { fillPublishedDates, traceTimeline } from './trace';
import { collectWitnesses, makeVerdict } from './verdict';

/** 每个疑点的单价（元）。 */
const PRICE_PER_CLAIM = 8;
/** 「我不知道」疑点的部分退款金额（元）。 */
const REFUND_PER_CLAIM = 4;
/** 单案最多查证的疑点数（用户勾选模式）。 */
const MAX_CLAIMS_PER_CASE = 10;
/** 自动模式（未传 claims）最多查证的疑点数。 */
const AUTO_CLAIM_LIMIT = 3;
/** 文案体检只溯源变形最明显的疑点数。 */
const SCRIPTCHECK_TRACE_LIMIT = 2;
/** 软超时：基础 55 秒，超过 3 个疑点后每个加 10 秒，最多 120 秒。 */
const SOFT_TIMEOUT_BASE_MS = 55_000;
const SOFT_TIMEOUT_PER_EXTRA_CLAIM_MS = 10_000;
const SOFT_TIMEOUT_MAX_MS = 120_000;

function softTimeoutMs(claimCount: number): number {
  const extra = Math.max(0, claimCount - AUTO_CLAIM_LIMIT) * SOFT_TIMEOUT_PER_EXTRA_CLAIM_MS;
  return Math.min(SOFT_TIMEOUT_MAX_MS, SOFT_TIMEOUT_BASE_MS + extra);
}

const CACHE_ROOT = path.join(process.cwd(), '.cache');
const PREVIEW_DIR = path.join(CACHE_ROOT, 'previews');
const CASE_DIR = path.join(CACHE_ROOT, 'cases');

const LEVEL_NAMES: Record<VerdictLevel, string> = {
  true: '属实',
  partly_true: '部分属实',
  out_of_context: '断章取义',
  unverified: '无法证实',
  false: '谣言',
};

export type PreviewClaimsOptions = {
  mode: Mode;
  inputType?: InputType;
  inputUrl?: string;
  inputTitle?: string;
};

export type RunInvestigationOptions = {
  signal?: AbortSignal;
  mode?: Mode;
  /** 预览页选中的疑点；传入后跳过拆疑点阶段。 */
  claims?: Claim[];
  selectedClaimIds?: string[];
  previewId?: string;
};

/** 8 位短 id：去掉连字符后截取。 */
function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

function dateStamp(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${month}${day}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 阶段之间检查取消信号；外部取消时不再继续消耗额度。 */
function ensureActive(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  const error = new Error('调查已取消');
  error.name = 'AbortError';
  throw error;
}

/** 写入 JSON 文件，目录不存在时自动创建；返回文件绝对路径。 */
async function saveJson(dir: string, name: string, value: unknown): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * 拆解疑点并落盘预览，供前端勾选后带 claims 立案。
 * 不调用元宝搜索；1–2 个疑点时 autoRun 为 true。
 */
export async function previewClaims(
  input: string,
  opts: PreviewClaimsOptions,
): Promise<ClaimsPreview> {
  const claims = await extractClaims(input, { mode: opts.mode });
  const preview = ClaimsPreviewSchema.parse({
    previewId: shortId(),
    mode: opts.mode,
    input,
    inputType: opts.inputType ?? 'text',
    ...(opts.inputUrl ? { inputUrl: opts.inputUrl } : {}),
    ...(opts.inputTitle ? { inputTitle: opts.inputTitle } : {}),
    claims,
    autoRun: claims.length >= 1 && claims.length <= 2,
    pricePerClaim: PRICE_PER_CLAIM,
    createdAt: new Date().toISOString(),
  });

  await saveJson(PREVIEW_DIR, preview.previewId, preview);
  return preview;
}

/** 变形越明显越靠前：同源转载越多、可用来源越多，越值得溯源。 */
function distortionScore(claimId: string, sources: Source[], groups: SourceGroup[]): number {
  const reposts = groups
    .filter((group) => group.claimId === claimId)
    .reduce((sum, group) => sum + Math.max(0, group.memberIds.length - 1), 0);
  const usable = sources.filter(
    (source) =>
      source.claimId === claimId &&
      source.reachable !== false &&
      (source.stance ?? 'irrelevant') !== 'irrelevant',
  ).length;
  return reposts * 10 + usable;
}

/** 文案体检只对变形最明显的最多 2 个疑点做溯源。 */
function selectTraceClaims(
  claims: Claim[],
  sources: Source[],
  groups: SourceGroup[],
): Claim[] {
  return claims
    .map((claim) => ({ claim, score: distortionScore(claim.id, sources, groups) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, SCRIPTCHECK_TRACE_LIMIT)
    .map((item) => item.claim);
}

/** 没有任何可用证人的疑点按「我不知道」处理，逐个部分退款。 */
function collectRefundClaimIds(
  claims: Claim[],
  sources: Source[],
  groups: SourceGroup[],
): string[] {
  return claims
    .filter(
      (claim) =>
        !collectWitnesses(claim, sources, groups).some(
          (witness) => witness.stance !== 'irrelevant',
        ),
    )
    .map((claim) => claim.id);
}

/**
 * 立案查证：拆疑点（或用传入的疑点）→ 搜证 → 分级 → 同源合并 → 溯源 → 判决 → 结算。
 * 任一阶段失败降级继续；判决完全失败时全额退款。
 */
export async function runInvestigation(
  input: string,
  emit: (event: CaseEvent) => void,
  opts: RunInvestigationOptions = {},
): Promise<CaseFile> {
  const startedAt = Date.now();
  const llmStart = llmStats.calls;
  const searchStart = searchStats.calls;
  const signal = opts.signal;
  const mode: Mode = opts.mode ?? 'factcheck';
  const caseId = `case-${dateStamp()}-${shortId()}`;

  let softTimer: ReturnType<typeof setTimeout> | undefined;
  let detachAbort: (() => void) | undefined;

  const send = (event: CaseEvent): void => {
    emit(CaseEventSchema.parse(event));
  };
  /** 各阶段耗时：start 记开始时间，done 打印并累计。 */
  const stageStartedAt = new Map<Stage, number>();
  const stageTimings: { stage: Stage; ms: number }[] = [];
  const stage = (name: Stage, status: 'start' | 'done', message: string): void => {
    if (status === 'start') {
      stageStartedAt.set(name, Date.now());
    } else {
      const began = stageStartedAt.get(name);
      if (began !== undefined) {
        const ms = Date.now() - began;
        stageTimings.push({ stage: name, ms });
        console.log(`[stage-timing] ${caseId} stage=${name} ms=${ms}`);
        stageStartedAt.delete(name);
      }
    }
    send({ type: 'stage', stage: name, status, message });
  };

  try {
    send({ type: 'case', id: caseId, input });

    // 1. 疑点：优先使用预览页选中的，否则现拆
    let pending: Claim[];
    let selectedIds: string[] | undefined;
    let plannedQueries: Map<string, { pro: string[]; con: string[] }> | undefined;

    if (opts.claims) {
      const pool = opts.claims;
      const chosen = opts.selectedClaimIds
        ? pool.filter((claim) => opts.selectedClaimIds?.includes(claim.id))
        : [...pool];
      pending = chosen.slice(0, MAX_CLAIMS_PER_CASE);
      selectedIds = pending.map((claim) => claim.id);

      stage('claims', 'start', `🗂 立案：本案查证你选中的 ${pending.length} 个疑点`);
      send({ type: 'claims', claims: pending });
      stage(
        'claims',
        'done',
        chosen.length > pending.length
          ? `已锁定 ${pending.length} 个疑点（单案上限 ${MAX_CLAIMS_PER_CASE} 个，其余 ${chosen.length - pending.length} 个本次不查）`
          : `已锁定 ${pending.length} 个疑点`,
      );
    } else {
      stage('claims', 'start', '正在拆解消息中的可核查疑点');
      // 自动模式最多 3 个疑点。合并「拆疑点 + 生成检索词」在 1–2 个疑点时实测可省约 2–4 秒。
      const combineQueries = process.env.COMBINE_CLAIM_QUERIES !== 'false';
      let extraction: { claims: Claim[]; queries: Map<string, { pro: string[]; con: string[] }> } = {
        claims: [],
        queries: new Map(),
      };
      try {
        extraction = await extractClaimsWithQueries(input, {
          mode,
          maxClaims: AUTO_CLAIM_LIMIT,
          withQueries: combineQueries,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        send({
          type: 'error',
          message: `拆解疑点失败：${messageOf(error)}`,
          recoverable: true,
        });
      }
      pending = extraction.claims.slice(0, AUTO_CLAIM_LIMIT);
      if (combineQueries && pending.length > 0) {
        plannedQueries = extraction.queries;
      }
      send({ type: 'claims', claims: pending });
      stage('claims', 'done', `拆出 ${pending.length} 个疑点（自动模式最多 ${AUTO_CLAIM_LIMIT} 个）`);
    }

    for (const claim of pending) {
      send({ type: 'claim_progress', claimId: claim.id, status: 'queued' });
    }

    // 软超时按疑点数计算：55 秒起步，超过 3 个后每个加 10 秒，最多 120 秒。
    const timeoutMs = softTimeoutMs(pending.length);
    const deadline = startedAt + timeoutMs;
    const deadlineReached = (): boolean => Date.now() >= deadline;
    let timedOut = false;
    let lineBroken = false;
    const forcedUnverified = new Set<string>();

    // 到点即中止在途搜索 / 模型请求，并直接进入判决。
    const stageAbort = new AbortController();
    softTimer = setTimeout(() => {
      timedOut = true;
      stageAbort.abort();
    }, Math.max(0, deadline - Date.now()));
    const onExternalAbort = (): void => {
      stageAbort.abort();
    };
    if (signal?.aborted) {
      stageAbort.abort();
    } else {
      signal?.addEventListener('abort', onExternalAbort, { once: true });
      detachAbort = () => signal?.removeEventListener('abort', onExternalAbort);
    }
    const stageSignal = stageAbort.signal;

    console.log(
      `[soft-timeout] ${caseId} claims=${pending.length} limitMs=${timeoutMs} deadline=${new Date(deadline).toISOString()}`,
    );

    // 2. 搜证
    ensureActive(signal);
    stage('search', 'start', `围绕疑点进行正反搜证（软超时 ${Math.round(timeoutMs / 1000)} 秒）`);
    let sources: Source[] = [];
    try {
      sources = await gatherEvidence(pending, send, {
        mode,
        ...(plannedQueries ? { preplanned: plannedQueries } : {}),
        deadline,
        signal: stageSignal,
        onClaimSkipped: (claimId, reason) => {
          if (reason === 'deadline') {
            timedOut = true;
          }
          forcedUnverified.add(claimId);
        },
        onLineBroken: () => {
          lineBroken = true;
        },
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      sources = [];
      send({ type: 'error', message: `搜证失败：${messageOf(error)}`, recoverable: true });
    }
    if (deadlineReached()) {
      timedOut = true;
    }
    stage(
      'search',
      'done',
      `共获得 ${sources.length} 条候选来源${
        lineBroken
          ? '（线索中断，基于已有证据结案）'
          : timedOut
            ? '（时间有限，部分疑点未完成搜证）'
            : ''
      }`,
    );

    // 3. 分级：网页发布时间补抓与分级并行；超时则直接跳过后续重阶段。
    ensureActive(signal);
    let graded: Source[] = sources;
    if (deadlineReached()) {
      timedOut = true;
      for (const claim of pending) {
        forcedUnverified.add(claim.id);
      }
      stage('grade', 'start', '按来源类型分级并判断立场');
      stage('grade', 'done', '时间有限，跳过来源分级');
    } else {
      stage('grade', 'start', '按来源类型分级并判断立场（并行补抓发布时间）');
      try {
        const [gradedResult, filled] = await Promise.all([
          gradeSources(pending, sources, send, { mode, signal: stageSignal }),
          fillPublishedDates(pending, sources, send, {
            anyStance: true,
            maxPerClaim: 6,
            deadline,
          }).catch((error: unknown) => {
              if (signal?.aborted) throw error;
              send({
                type: 'error',
                message: `发布时间补抓失败：${messageOf(error)}`,
                recoverable: true,
              });
              return new Map<string, string>();
            },
          ),
        ]);
        graded = gradedResult.map((source) => {
          const publishedAt = filled.get(source.id);
          return publishedAt && !source.publishedAt
            ? { ...source, publishedAt, publishedAtStatus: 'known' as const }
            : source;
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        graded = sources;
        send({ type: 'error', message: `来源分级失败：${messageOf(error)}`, recoverable: true });
      }
      // 分级途中被软超时中止时，本批疑点都视为未完成核查。
      if (timedOut) {
        for (const claim of pending) {
          forcedUnverified.add(claim.id);
        }
      }
      stage('grade', 'done', `完成 ${graded.length} 条来源分级`);
    }

    // 4. 同源合并
    ensureActive(signal);
    let groups: SourceGroup[] = [];
    if (deadlineReached()) {
      timedOut = true;
      stage('cluster', 'start', '识别同源转载并合并');
      stage('cluster', 'done', '时间有限，跳过同源合并');
      send({ type: 'groups', groups: [] });
    } else {
      stage('cluster', 'start', '识别同源转载并合并');
      try {
        groups = await clusterSources(pending, graded, send, undefined, {
          deadline,
          signal: stageSignal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        groups = [];
        send({ type: 'groups', groups: [] });
        send({ type: 'error', message: `同源合并失败：${messageOf(error)}`, recoverable: true });
      }
      stage('cluster', 'done', `合并为 ${groups.length} 个同源组`);
    }

    // 5. 溯源：文案体检只做变形最明显的 2 个
    ensureActive(signal);
    const traceTargets =
      mode === 'scriptcheck' ? selectTraceClaims(pending, graded, groups) : pending;
    let timelines: Record<string, TimelineStep[]> = {};
    if (deadlineReached()) {
      timedOut = true;
      stage('trace', 'start', '按发布时间还原信息变形过程');
      stage('trace', 'done', '时间有限，跳过溯源时间线');
    } else {
      stage('trace', 'start', '按发布时间还原信息变形过程');
      try {
        if (traceTargets.length > 0) {
          timelines = await traceTimeline(traceTargets, graded, groups, send, {
            deadline,
            signal: stageSignal,
          });
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        timelines = {};
        send({ type: 'error', message: `溯源失败：${messageOf(error)}`, recoverable: true });
      }
      const tracedCount = Object.values(timelines).filter((steps) => steps.length > 0).length;
      stage(
        'trace',
        'done',
        mode === 'scriptcheck'
          ? `完成 ${tracedCount} 条时间线（文案体检仅溯源变形最明显的 ${traceTargets.length} 个疑点）`
          : `完成 ${tracedCount} 条时间线`,
      );
    }
    for (const claim of pending) {
      if (!(claim.id in timelines)) {
        timelines[claim.id] = [];
        send({ type: 'timeline', claimId: claim.id, steps: [] });
      }
    }

    // 6. 判决：已到软截止时间时直接基于现有证据判决，不再等待新证据。
    ensureActive(signal);
    if (deadlineReached()) {
      timedOut = true;
    }
    stage(
      'verdict',
      'start',
      lineBroken
        ? '线索中断，基于已有证据直接判决'
        : timedOut
          ? '时间有限，基于已获取证据直接判决'
          : '综合证据给出五档判决',
    );
    const searchPlans = new Map<string, { executed: number; pro: string[]; con: string[] }>();
    for (const claim of pending) {
      const plan = getExecutedSearchPlan(claim);
      if (plan) {
        searchPlans.set(claim.id, { executed: plan.executed, pro: plan.pro, con: plan.con });
      }
    }

    let verdict: Verdict | null = null;
    let verdictError = '';
    try {
      verdict = await makeVerdict(input, pending, graded, groups, timelines, {
        mode,
        searchPlans,
        deadline,
        timedOut,
        lineBroken,
        forceUnverifiedClaimIds: forcedUnverified,
        signal: stageSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      verdictError = messageOf(error);
      send({ type: 'error', message: `判决失败：${verdictError}`, recoverable: true });
    }

    if (verdict) {
      for (const claim of pending) {
        send({ type: 'claim_progress', claimId: claim.id, status: 'done' });
      }
      send({ type: 'verdict', verdict });
      stage(
        'verdict',
        'done',
        `判决完成：${LEVEL_NAMES[verdict.level]}${timedOut ? '（时间有限，基于已获取证据结案）' : ''}`,
      );
    } else {
      stage('verdict', 'done', '未能生成判决结论，本案全额退款');
    }

    // 7. 结算
    const checkedClaimIds = pending.map((claim) => claim.id);
    let billing: Billing;
    if (verdict) {
      const noEvidenceIds = collectRefundClaimIds(pending, graded, groups);
      const refundClaimIds = [...new Set([...noEvidenceIds, ...forcedUnverified])];
      const timeoutRefundCount = refundClaimIds.filter((id) => forcedUnverified.has(id)).length;
      const noEvidenceRefundCount = refundClaimIds.length - timeoutRefundCount;
      const reasons: string[] = [];
      if (noEvidenceRefundCount > 0) {
        reasons.push(`${noEvidenceRefundCount} 个疑点没有可核对的独立证据（判为「我不知道」）`);
      }
      if (timeoutRefundCount > 0) {
        reasons.push(`${timeoutRefundCount} 个疑点因时间有限未完成核查（判为「我不知道」）`);
      }
      billing = {
        pricePerClaim: PRICE_PER_CLAIM,
        checkedClaimIds,
        charged: PRICE_PER_CLAIM * checkedClaimIds.length,
        refundClaimIds,
        refunded: REFUND_PER_CLAIM * refundClaimIds.length,
        ...(refundClaimIds.length > 0
          ? { reason: `${reasons.join('；')}，按每个 ${REFUND_PER_CLAIM} 元部分退款。` }
          : {}),
      };
    } else {
      const charged = PRICE_PER_CLAIM * checkedClaimIds.length;
      billing = {
        pricePerClaim: PRICE_PER_CLAIM,
        checkedClaimIds,
        charged,
        refundClaimIds: [...checkedClaimIds],
        refunded: charged,
        reason: `判决阶段未能生成任何疑点结论${verdictError ? `（${verdictError}）` : ''}，已按全额退款处理。`,
      };
    }

    const stats: Stats = {
      apiCalls: llmStats.calls - llmStart + (searchStats.calls - searchStart),
      sourcesVisited: graded.length,
      independentWitnesses: countIndependent(groups, graded),
      durationMs: Date.now() - startedAt,
      claimsChecked: pending.length,
    };

    const caseFile = CaseFileSchema.parse({
      id: caseId,
      input,
      mode,
      ...(opts.previewId ? { previewId: opts.previewId } : {}),
      ...(selectedIds ? { selectedClaimIds: selectedIds } : {}),
      billing,
      createdAt: new Date().toISOString(),
      claims: pending,
      sources: graded,
      groups,
      timelines,
      verdict,
      stats,
    });

    try {
      await saveJson(CASE_DIR, caseFile.id, caseFile);
    } catch (error) {
      send({
        type: 'error',
        message: `卷宗落盘失败：${messageOf(error)}`,
        recoverable: true,
      });
    }

    console.log(
      `[stage-timing] ${caseId} total ms=${stats.durationMs} ${JSON.stringify(stageTimings)}`,
    );
    send({ type: 'stats', stats });
    send({ type: 'billing', billing });
    send({ type: 'done', caseFile });

    return caseFile;
  } catch (error) {
    if (signal?.aborted) {
      send({
        type: 'billing',
        billing: {
          pricePerClaim: PRICE_PER_CLAIM,
          checkedClaimIds: [],
          charged: 0,
          refundClaimIds: [],
          refunded: 0,
          reason: '调查已取消，本次未产生费用。',
        },
      });
    }
    throw error;
  } finally {
    if (softTimer) {
      clearTimeout(softTimer);
    }
    detachAbort?.();
  }
}

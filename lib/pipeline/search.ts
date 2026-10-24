/**
 * 流水线第二步：正反搜证。
 * 每个疑点生成 pro / con 两组搜索词，并行检索后按 url 去重、按相关度截断。
 */
import pLimit from 'p-limit';
import { z } from 'zod';
import { SourceSchema, type CaseEvent, type Claim, type Mode, type Source } from '../../types/case';
import { chatJSON, type ChatJsonOptions } from '../llm';
import { createSearchBudget, type SearchResult } from '../yuanbao';

/** 疑点级并发上限：配合元宝 3 路并发，避免一次排满所有检索词。 */
const CLAIM_CONCURRENCY = 2;
const RESULTS_PER_QUERY = 6;
/** 元宝只接受 Cnt=10 等固定档位，取 10 条后本地截取 6 条 */
const REQUEST_CNT = 10;
const MAX_SOURCES_PER_CLAIM = 15;
/** 来源摘要字数上限：接口 passage 可达 800 字，入库前统一截断。 */
const MAX_SNIPPET_CHARS = 200;
/** 修复请求里回传上一次输出的长度上限，避免提示词过长 */
const REPAIR_OUTPUT_LIMIT = 1200;
/** 元宝搜索连续失败超过 2 次即判定线索中断，停止继续检索。 */
const MAX_SEARCH_ERRORS = 2;

/** 搜索词唯一标准结构：pro / con 两个数组，每个元素都是非空字符串。 */
const QueryPlanSchema = z.strictObject({
  pro: z.array(z.string().trim().min(1)).min(1),
  con: z.array(z.string().trim().min(1)).min(1),
});

type QueryPlanData = z.infer<typeof QueryPlanSchema>;

export type QueryCounts = {
  pro: number;
  con: number;
};

/** 每疑点默认 1 条 pro + 2 条 con，共 3 次搜索；可用环境变量或调用参数覆盖。 */
export const DEFAULT_QUERY_COUNTS: QueryCounts = { pro: 1, con: 2 };

function envCount(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 && raw <= 5 ? raw : fallback;
}

/** 合并调用参数与环境变量，最终限制在 1–5 条之间。 */
export function resolveQueryCounts(overrides?: Partial<QueryCounts>): QueryCounts {
  const pro = overrides?.pro ?? envCount('SEARCH_PRO_COUNT', DEFAULT_QUERY_COUNTS.pro);
  const con = overrides?.con ?? envCount('SEARCH_CON_COUNT', DEFAULT_QUERY_COUNTS.con);
  const clamp = (value: number): number => Math.min(5, Math.max(1, Math.trunc(value)));
  return { pro: clamp(pro), con: clamp(con) };
}

/** 外部依赖，测试可注入桩函数，避免真实调用模型。 */
export type SearchDeps = {
  chat: (options: ChatJsonOptions<unknown>) => Promise<unknown>;
};

const defaultDeps: SearchDeps = {
  chat: (options) => chatJSON(options),
};

/** 单个疑点的检索词方案与诊断信息。 */
export type ClaimQueryPlan = {
  claimId: string;
  pro: string[];
  con: string[];
  /** 是否使用了确定性兜底检索词 */
  fallback: boolean;
  /** 是否经过一次 JSON 修复请求后成功 */
  repaired: boolean;
  /** 实际执行的检索词数量（受搜索预算限制） */
  executed: number;
};

export type GatherEvidenceOptions = {
  deps?: SearchDeps;
  /** 演示模式：每个疑点 1 条 pro + 2 条 con，最多 3 个疑点共 9 次搜索 */
  demo?: boolean;
  mode?: Mode;
  perClaimLimit?: number;
  /** 覆盖每疑点的 pro / con 条数，默认取环境变量或 1 pro + 2 con。 */
  queryCounts?: Partial<QueryCounts>;
  /** 拆疑点阶段一并生成的检索词；命中时不再单独调用模型。 */
  preplanned?: ReadonlyMap<string, { pro: string[]; con: string[] }>;
  /** 软截止时间（epoch ms）；到点后尚未开始的疑点不再搜证。 */
  deadline?: number;
  /** 因软截止时间或线索中断未开始搜证的疑点。 */
  onClaimSkipped?: (claimId: string, reason: 'deadline' | 'line_broken') => void;
  /** 元宝搜索连续失败超过阈值时通知调用方：线索中断。 */
  onLineBroken?: () => void;
  /** 软超时取消信号，用于中止在途搜索与检索词生成。 */
  signal?: AbortSignal;
  onPlan?: (plan: ClaimQueryPlan) => void;
};

const executedPlans = new WeakMap<Claim, ClaimQueryPlan>();

/** 查询疑点在本次搜证中实际执行的检索计划；未参与搜证时返回 undefined。 */
export function getExecutedSearchPlan(claim: Claim): ClaimQueryPlan | undefined {
  const plan = executedPlans.get(claim);
  return plan ? { ...plan, pro: [...plan.pro], con: [...plan.con] } : undefined;
}

type Direction = 'pro' | 'con';

type PlannedQuery = {
  direction: Direction;
  query: string;
};

type QueryTask = PlannedQuery & {
  claim: Claim;
  results: Promise<SearchResult[]>;
};

/** 用疑点原文拼出完整 JSON 示例，避免模型照抄无意义的占位符。 */
function buildExample(claimText: string, counts: QueryCounts): string {
  const seed = claimText.length > 24 ? claimText.slice(0, 24) : claimText;
  const pro = Array.from({ length: counts.pro }, (_, index) =>
    index === 0 ? seed : `${seed} 证据`,
  );
  const con = [`${seed} 辟谣`, `${seed} 真相 原文 出处`].slice(0, counts.con);
  return JSON.stringify({ pro, con });
}

function buildQueryPrompt(claimText: string, counts: QueryCounts, mode: Mode = 'factcheck'): string {
  const scriptcheckHints = mode === 'scriptcheck'
    ? '\n- scriptcheck 额外关注：pro 加入史料、记载、出处、原文方向；con 加入考证、辟谣、史学界、真实情况方向。'
    : '';
  return `你是检索策略师，为事实核查生成搜索词。

疑点：${claimText}

只允许输出一个 JSON 对象，且只允许包含 pro 和 con 两个字段。禁止使用 queries、keywords、support、refute、reason、result 等任何其他字段。
- pro：${counts.pro} 条，用于「试图证实」该疑点的检索词，寻找支持该说法的证据；
- con：${counts.con} 条，用于「辟谣 / 真相 / 原文 / 出处」方向的检索词，寻找反驳、澄清和原始出处。${scriptcheckHints}

完整 JSON 示例（字段名、数组结构和元素类型必须完全一致）：
${buildExample(claimText, counts)}

要求：
1. pro 和 con 都必须是非空字符串数组，每个元素不能是空字符串；
2. 检索词要具体可查，保留关键人物、时间、数字；
3. 不用引号、布尔语法或 site: 限定，每条不超过 30 字；
4. 只输出上述 JSON 对象，不要 Markdown 代码块、注释或解释。`;
}

function buildRepairPrompt(claimText: string, counts: QueryCounts, mode: Mode = 'factcheck'): string {
  const scriptcheckHints = mode === 'scriptcheck'
    ? '\n- scriptcheck 额外关注：pro 加入史料、记载、出处、原文方向；con 加入考证、辟谣、史学界、真实情况方向。'
    : '';
  return `你是 JSON 结构修复器。上一次为事实核查疑点生成搜索词时，输出的 JSON 不符合约定，请只修复结构，不要改变检索意图。${scriptcheckHints}

疑点：${claimText}

唯一允许的结构（只能有 pro 和 con 两个字段）：
${buildExample(claimText, counts)}

规则：
- pro 是「试图证实」该疑点的检索词，需要 ${counts.pro} 条；
- con 是「辟谣 / 真相 / 原文 / 出处」方向的检索词，需要 ${counts.con} 条；
- 每个元素必须是非空字符串；
- 不得输出 queries、keywords、support、refute、reason 等任何其他字段；
- 只输出修复后的 JSON 对象，不要 Markdown、注释或解释。`;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('；');
}

/** 只记录脱敏后的键名，不输出模型生成的任何字段值。 */
function describeJsonKeys(value: unknown): string {
  if (Array.isArray(value)) {
    return `数组（${value.length} 项）`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    return keys.length === 0 ? '（空对象）' : keys.map((key) => `"${key}"`).join('、');
  }
  return typeof value;
}

function stringifyForRepair(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > REPAIR_OUTPUT_LIMIT ? `${text.slice(0, REPAIR_OUTPUT_LIMIT)}…` : text;
}

/** 发起一次生成请求；结构不符时记录脱敏键名 + 校验错误，并做一次专门的 JSON 修复。 */
async function requestPlan(
  claim: Claim,
  counts: QueryCounts,
  emit: (event: CaseEvent) => void,
  deps: SearchDeps,
  mode: Mode = 'factcheck',
  signal?: AbortSignal,
): Promise<{ plan: QueryPlanData; repaired: boolean }> {
  const raw = await deps.chat({
    system: buildQueryPrompt(claim.text, counts, mode),
    user: claim.text,
    schema: z.unknown(),
    temperature: 0.2,
    maxTokens: 1_000,
    timeoutMs: 60_000,
    ...(signal ? { signal } : {}),
  });

  const parsed = QueryPlanSchema.safeParse(raw);
  if (parsed.success) {
    return { plan: parsed.data, repaired: false };
  }

  const issues = formatIssues(parsed.error);
  emit({
    type: 'error',
    recoverable: true,
    message: `疑点 ${claim.id} 搜索词结构校验失败：原始 JSON 字段 ${describeJsonKeys(raw)}；错误：${issues}；已发起修复请求`,
  });

  const repairedRaw = await deps.chat({
    system: buildRepairPrompt(claim.text, counts, mode),
    user: `上一次输出：${stringifyForRepair(raw)}\n校验错误：${issues}`,
    schema: z.unknown(),
    temperature: 0.2,
    maxTokens: 1_000,
    timeoutMs: 60_000,
    ...(signal ? { signal } : {}),
  });

  const repaired = QueryPlanSchema.safeParse(repairedRaw);
  if (repaired.success) {
    return { plan: repaired.data, repaired: true };
  }

  throw new Error(
    `修复请求仍返回错误结构：字段 ${describeJsonKeys(repairedRaw)}；错误：${formatIssues(repaired.error)}`,
  );
}

/** 最终兜底：不再调用模型，用疑点原文生成确定性检索词。 */
function fallbackQueries(claim: Claim, mode: Mode = 'factcheck'): { pro: string[]; con: string[] } {
  if (mode === 'scriptcheck') {
    return {
      pro: [`${claim.text} 史料 原文`],
      con: [`${claim.text} 考证 史学界`, `${claim.text} 辟谣 真实情况`],
    };
  }
  return {
    pro: [claim.text],
    con: [`${claim.text} 辟谣`, `${claim.text} 真相 原文 出处`],
  };
}

/** 生成单个疑点的检索词；任何结构异常都会降级为确定性兜底。 */
export async function planClaimQueries(
  claim: Claim,
  emit: (event: CaseEvent) => void,
  deps: SearchDeps = defaultDeps,
  demoOrMode: boolean | Mode = false,
  mode: Mode = typeof demoOrMode === 'string' ? demoOrMode : 'factcheck',
  countOverrides?: Partial<QueryCounts>,
  signal?: AbortSignal,
): Promise<ClaimQueryPlan> {
  const counts = resolveQueryCounts(countOverrides);

  try {
    const { plan, repaired } = await requestPlan(claim, counts, emit, deps, mode, signal);
    return {
      claimId: claim.id,
      pro: plan.pro.slice(0, counts.pro),
      con: plan.con.slice(0, counts.con),
      fallback: false,
      repaired,
      executed: 0,
    };
  } catch (error) {
    emit({
      type: 'error',
      recoverable: true,
      message: `疑点 ${claim.id} 搜索词生成失败：${(error as Error).message}`,
    });

    const fallback = fallbackQueries(claim, mode);
    emit({
      type: 'stage',
      stage: 'search',
      status: 'start',
      message: `疑点 ${claim.id} 搜索词生成异常，已使用保守兜底检索词`,
    });

    return {
      claimId: claim.id,
      pro: fallback.pro,
      con: fallback.con,
      fallback: true,
      repaired: false,
      executed: 0,
    };
  }
}

/** 正反交替排列，预算被截断时每个疑点仍能保留两个方向。 */
function interleaveQueries(plan: ClaimQueryPlan): PlannedQuery[] {
  const queries: PlannedQuery[] = [];
  const rounds = Math.max(plan.pro.length, plan.con.length);
  for (let index = 0; index < rounds; index += 1) {
    if (plan.pro[index]) {
      queries.push({ direction: 'pro', query: plan.pro[index] });
    }
    if (plan.con[index]) {
      queries.push({ direction: 'con', query: plan.con[index] });
    }
  }
  return queries;
}

/** 提取中文二元组，用于计算 snippet 与疑点的关键词重合度。 */
function bigrams(text: string): string[] {
  const cleaned = text.replace(/[\s，。！？、；：""''（）()《》【】…—\-·]/g, '');
  const grams: string[] = [];
  for (let index = 0; index < cleaned.length - 1; index += 1) {
    grams.push(cleaned.slice(index, index + 2));
  }
  return grams;
}

function relevance(claimText: string, result: SearchResult): number {
  const grams = bigrams(claimText);
  if (grams.length === 0) {
    return 0;
  }
  const haystack = `${result.title}${result.snippet}`;
  const hits = grams.filter((gram) => haystack.includes(gram)).length;
  return hits / grams.length;
}

/** 摘要按字符截断，超过上限时补省略号。 */
function clipSnippet(text: string): string {
  const chars = [...text];
  if (chars.length <= MAX_SNIPPET_CHARS) {
    return text;
  }
  return `${chars.slice(0, MAX_SNIPPET_CHARS - 1).join('')}…`;
}

/** 正反并行搜证，逐条推送来源；单路失败降级为空结果。 */
export async function gatherEvidence(
  claims: Claim[],
  emit: (event: CaseEvent) => void,
  options: GatherEvidenceOptions = {},
): Promise<Source[]> {
  if (claims.length === 0) {
    return [];
  }

  const deps = options.deps ?? defaultDeps;
  const mode = options.mode ?? 'factcheck';
  const counts = resolveQueryCounts(options.queryCounts);
  const perClaimLimit = options.perClaimLimit ?? counts.pro + counts.con;
  const tasks: QueryTask[] = [];

  // 元宝接口连续失败超过阈值时停止继续检索，改为用已有证据结案。
  let searchErrors = 0;
  let lineBroken = false;
  const noteSearchError = (query: string, error: unknown): void => {
    if (lineBroken || options.signal?.aborted) {
      return;
    }
    searchErrors += 1;
    emit({
      type: 'error',
      message: `搜索「${query}」失败：${(error as Error).message}`,
      recoverable: true,
    });
    if (searchErrors <= MAX_SEARCH_ERRORS) {
      return;
    }
    lineBroken = true;
    emit({
      type: 'error',
      message: '线索中断：元宝搜索连续失败超过 2 次，已停止继续检索；将基于已有证据按「无法证实」结案。',
      recoverable: true,
    });
    options.onLineBroken?.();
  };

  // 拆疑点阶段已生成检索词的疑点不再单独调用模型；其余并行补生成。
  const plans = await Promise.all(
    claims.map((claim): Promise<ClaimQueryPlan> | ClaimQueryPlan => {
      const pre = options.preplanned?.get(claim.id);
      if (pre && pre.pro.length > 0 && pre.con.length > 0) {
        return {
          claimId: claim.id,
          pro: pre.pro.slice(0, counts.pro),
          con: pre.con.slice(0, counts.con),
          fallback: false,
          repaired: false,
          executed: 0,
        };
      }
      return planClaimQueries(claim, emit, deps, false, mode, counts, options.signal);
    }),
  );

  // 疑点级并发 2：既保持吞吐，又能在软超时后及时跳过未开始的疑点。
  const claimLimit = pLimit(CLAIM_CONCURRENCY);
  await Promise.all(
    plans.map((plan, index) =>
      claimLimit(async () => {
        const claim = claims[index];

        if (options.deadline !== undefined && Date.now() >= options.deadline) {
          options.onClaimSkipped?.(claim.id, 'deadline');
          emit({
            type: 'error',
            message: `疑点 ${claim.id} 因时间不足未开始搜证，按「我不知道」处理`,
            recoverable: true,
          });
          return;
        }

        if (lineBroken) {
          options.onClaimSkipped?.(claim.id, 'line_broken');
          return;
        }

        emit({ type: 'claim_progress', claimId: claim.id, status: 'searching' });
        const desired = interleaveQueries(plan);
        const budget = createSearchBudget(perClaimLimit);
        const claimTasks: QueryTask[] = [];
        let executed = 0;

        for (const item of desired) {
          if (budget.remaining() <= 0) {
            break;
          }
          const task: QueryTask = {
            claim,
            direction: item.direction,
            query: item.query,
            results: budget
              .search(item.query, {
                cnt: REQUEST_CNT,
                ...(options.signal ? { signal: options.signal } : {}),
              })
              .then((results) => results.slice(0, RESULTS_PER_QUERY))
              .catch((error: unknown) => {
                noteSearchError(item.query, error);
                return [];
              }),
          };
          tasks.push(task);
          claimTasks.push(task);
          executed += 1;
        }

        const actual = desired.slice(0, executed);
        const actualPlan: ClaimQueryPlan = {
          ...plan,
          executed,
          pro: actual.filter((item) => item.direction === 'pro').map((item) => item.query),
          con: actual.filter((item) => item.direction === 'con').map((item) => item.query),
        };
        executedPlans.set(claim, actualPlan);
        options.onPlan?.(actualPlan);

        if (executed < desired.length) {
          emit({
            type: 'error',
            message: `疑点 ${claim.id} 搜索预算不足，${desired.length - executed} 条检索词未执行（单疑点上限 ${perClaimLimit} 次）`,
            recoverable: true,
          });
        }

        await Promise.all(claimTasks.map((task) => task.results));
      }),
    ),
  );

  const sources: Source[] = [];
  let sequence = 0;

  for (const claim of claims) {
    const seen = new Set<string>();
    const candidates: { result: SearchResult; task: QueryTask; score: number; order: number }[] =
      [];
    let order = 0;

    for (const task of tasks.filter((item) => item.claim.id === claim.id)) {
      const results = await task.results;
      for (const result of results) {
        order += 1;
        if (!result.url || seen.has(result.url)) {
          continue;
        }
        seen.add(result.url);
        candidates.push({ result, task, score: relevance(claim.text, result), order });
      }
    }

    candidates.sort((a, b) => b.score - a.score || a.order - b.order);

    for (const { result, task } of candidates.slice(0, MAX_SOURCES_PER_CLAIM)) {
      sequence += 1;
      const source = SourceSchema.parse({
        id: `s${sequence}`,
        claimId: claim.id,
        url: result.url,
        site: result.site,
        title: result.title,
        snippet: clipSnippet(result.snippet),
        publishedAt: result.publishedAt,
        publishedAtStatus: result.publishedAt ? 'known' : 'missing',
        direction: task.direction,
        query: task.query,
      });
      sources.push(source);
      emit({ type: 'source', source });
    }
  }

  return sources;
}

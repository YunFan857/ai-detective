/**
 * 流水线第二步：正反搜证。
 * 每个疑点生成 pro / con 两组搜索词，并行检索后按 url 去重、按相关度截断。
 */
import { z } from 'zod';
import { SourceSchema, type CaseEvent, type Claim, type Source } from '../../types/case';
import { chatJSON, type ChatJsonOptions } from '../llm';
import { createSearchBudget, type SearchResult } from '../yuanbao';

const RESULTS_PER_QUERY = 6;
/** 元宝只接受 Cnt=10 等固定档位，取 10 条后本地截取 6 条 */
const REQUEST_CNT = 10;
const MAX_SOURCES_PER_CLAIM = 15;
const SEARCH_BUDGET = 10;
/** 修复请求里回传上一次输出的长度上限，避免提示词过长 */
const REPAIR_OUTPUT_LIMIT = 1200;

/** 搜索词唯一标准结构：pro / con 两个数组，每个元素都是非空字符串。 */
const QueryPlanSchema = z.strictObject({
  pro: z.array(z.string().trim().min(1)).min(1),
  con: z.array(z.string().trim().min(1)).min(1),
});

type QueryPlanData = z.infer<typeof QueryPlanSchema>;

type QueryCounts = {
  pro: number;
  con: number;
};

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
  onPlan?: (plan: ClaimQueryPlan) => void;
};

type Direction = 'pro' | 'con';

type PlannedQuery = {
  direction: Direction;
  query: string;
};

type QueryTask = PlannedQuery & {
  claim: Claim;
  results: Promise<SearchResult[]>;
};

function isDemoMode(): boolean {
  return process.env.USE_MOCK === 'true';
}

function queryCounts(demo: boolean): QueryCounts {
  return demo ? { pro: 1, con: 2 } : { pro: 2, con: 2 };
}

/** 用疑点原文拼出完整 JSON 示例，避免模型照抄无意义的占位符。 */
function buildExample(claimText: string, counts: QueryCounts): string {
  const seed = claimText.length > 24 ? claimText.slice(0, 24) : claimText;
  const pro = Array.from({ length: counts.pro }, (_, index) =>
    index === 0 ? seed : `${seed} 证据`,
  );
  const con = [`${seed} 辟谣`, `${seed} 真相 原文 出处`].slice(0, counts.con);
  return JSON.stringify({ pro, con });
}

function buildQueryPrompt(claimText: string, counts: QueryCounts): string {
  return `你是检索策略师，为事实核查生成搜索词。

疑点：${claimText}

只允许输出一个 JSON 对象，且只允许包含 pro 和 con 两个字段。禁止使用 queries、keywords、support、refute、reason、result 等任何其他字段。
- pro：${counts.pro} 条，用于「试图证实」该疑点的检索词，寻找支持该说法的证据；
- con：${counts.con} 条，用于「辟谣 / 真相 / 原文 / 出处」方向的检索词，寻找反驳、澄清和原始出处。

完整 JSON 示例（字段名、数组结构和元素类型必须完全一致）：
${buildExample(claimText, counts)}

要求：
1. pro 和 con 都必须是非空字符串数组，每个元素不能是空字符串；
2. 检索词要具体可查，保留关键人物、时间、数字；
3. 不用引号、布尔语法或 site: 限定，每条不超过 30 字；
4. 只输出上述 JSON 对象，不要 Markdown 代码块、注释或解释。`;
}

function buildRepairPrompt(claimText: string, counts: QueryCounts): string {
  return `你是 JSON 结构修复器。上一次为事实核查疑点生成搜索词时，输出的 JSON 不符合约定，请只修复结构，不要改变检索意图。

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
): Promise<{ plan: QueryPlanData; repaired: boolean }> {
  const raw = await deps.chat({
    system: buildQueryPrompt(claim.text, counts),
    user: claim.text,
    schema: z.unknown(),
    temperature: 0,
    timeoutMs: 60_000,
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
    system: buildRepairPrompt(claim.text, counts),
    user: `上一次输出：${stringifyForRepair(raw)}\n校验错误：${issues}`,
    schema: z.unknown(),
    temperature: 0,
    timeoutMs: 60_000,
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
function fallbackQueries(claim: Claim): { pro: string[]; con: string[] } {
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
  demo = isDemoMode(),
): Promise<ClaimQueryPlan> {
  const counts = queryCounts(demo);

  try {
    const { plan, repaired } = await requestPlan(claim, counts, emit, deps);
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

    const fallback = fallbackQueries(claim);
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
  const demo = options.demo ?? isDemoMode();
  const budget = createSearchBudget(SEARCH_BUDGET);
  const plans = await Promise.all(claims.map((claim) => planClaimQueries(claim, emit, deps, demo)));

  const tasks: QueryTask[] = [];

  plans.forEach((plan, index) => {
    const claim = claims[index];
    const desired = interleaveQueries(plan);
    let executed = 0;

    for (const item of desired) {
      if (budget.remaining() <= 0) {
        break;
      }
      tasks.push({
        claim,
        direction: item.direction,
        query: item.query,
        results: budget
          .search(item.query, { cnt: REQUEST_CNT })
          .then((results) => results.slice(0, RESULTS_PER_QUERY))
          .catch((error: unknown) => {
            emit({
              type: 'error',
              message: `搜索「${item.query}」失败：${(error as Error).message}`,
              recoverable: true,
            });
            return [];
          }),
      });
      executed += 1;
    }

    plan.executed = executed;
    options.onPlan?.(plan);

    if (executed < desired.length) {
      emit({
        type: 'error',
        message: `疑点 ${claim.id} 搜索预算不足，${desired.length - executed} 条检索词未执行（单案上限 ${SEARCH_BUDGET} 次）`,
        recoverable: true,
      });
    }
  });

  // 全部搜索并行；yuanbao 内部已有并发限制
  await Promise.all(tasks.map((task) => task.results));

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
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        direction: task.direction,
        query: task.query,
      });
      sources.push(source);
      emit({ type: 'source', source });
    }
  }

  return sources;
}

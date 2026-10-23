/**
 * 流水线第二步：正反搜证。
 * 每个疑点生成 pro / con 两组搜索词，并行检索后按 url 去重、按相关度截断。
 */
import { z } from 'zod';
import { SourceSchema, type CaseEvent, type Claim, type Source } from '../../types/case';
import { chatJSON } from '../llm';
import { createSearchBudget, type SearchResult } from '../yuanbao';

const RESULTS_PER_QUERY = 6;
/** 元宝只接受 Cnt=10 等固定档位，取 10 条后本地截取 6 条 */
const REQUEST_CNT = 10;
const MAX_SOURCES_PER_CLAIM = 15;
const SEARCH_BUDGET = 10;

const CON_HINTS = ['辟谣', '真相', '原文', '出处', '澄清'];

const QueryPlanSchema = z.object({
  pro: z.array(z.string().trim().min(1)).length(2),
  con: z
    .array(z.string().trim().min(1))
    .length(2)
    .refine((queries) => queries.every((query) => CON_HINTS.some((hint) => query.includes(hint))), {
      message: `con 组每条搜索词必须包含 ${CON_HINTS.join('、')} 之一`,
    }),
});

type Direction = 'pro' | 'con';

type QueryPlan = {
  claim: Claim;
  direction: Direction;
  query: string;
};

type QueryTask = QueryPlan & {
  results: Promise<SearchResult[]>;
};

function buildQueryPrompt(claim: Claim): string {
  return `你是检索策略师，为事实核查生成搜索词。

疑点：${claim.text}

请生成 4 条中文搜索词：
- pro：2 条，试图找到支持该疑点的证据；
- con：2 条，专门寻找辟谣、反驳、原始出处、澄清，每条必须包含「辟谣」「真相」「原文」「出处」「澄清」之一。
要求：具体可检索，保留关键人物、时间、数字；不用引号、布尔语法或 site: 限定；每条不超过 30 字。

只输出如下格式的 JSON 对象，不要 Markdown、注释或解释：
{"pro":["搜索词1","搜索词2"],"con":["搜索词1","搜索词2"]}`;
}

async function planQueries(claim: Claim, emit: (event: CaseEvent) => void): Promise<QueryPlan[]> {
  try {
    const plan = await chatJSON({
      system: buildQueryPrompt(claim),
      user: claim.text,
      schema: QueryPlanSchema,
      temperature: 0,
      timeoutMs: 60_000,
    });

    // 正反交替，预算被截断时每个疑点仍能保留两个方向
    return [
      { claim, direction: 'pro', query: plan.pro[0] },
      { claim, direction: 'con', query: plan.con[0] },
      { claim, direction: 'pro', query: plan.pro[1] },
      { claim, direction: 'con', query: plan.con[1] },
    ];
  } catch (error) {
    emit({
      type: 'error',
      message: `疑点 ${claim.id} 搜索词生成失败：${(error as Error).message}`,
      recoverable: true,
    });
    return [];
  }
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
): Promise<Source[]> {
  if (claims.length === 0) {
    return [];
  }

  const budget = createSearchBudget(SEARCH_BUDGET);
  const planned = await Promise.all(claims.map((claim) => planQueries(claim, emit)));

  const tasks = planned.flat().map((task) => ({
    ...task,
    results: budget
      .search(task.query, { cnt: REQUEST_CNT })
      .then((results) => results.slice(0, RESULTS_PER_QUERY))
      .catch((error: unknown) => {
        emit({
          type: 'error',
          message: `搜索「${task.query}」失败：${(error as Error).message}`,
          recoverable: true,
        });
        return [];
      }),
  }));

  // 全部搜索并行；yuanbao 内部已有并发限制
  await Promise.all(tasks.map((task) => task.results));

  const sources: Source[] = [];
  let sequence = 0;

  for (const claim of claims) {
    const seen = new Set<string>();
    const candidates: { result: SearchResult; task: QueryTask; score: number; order: number }[] = [];
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

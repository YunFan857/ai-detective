/**
 * 流水线第四步：同源合并。
 * 按疑点分别聚类：先算文本相似度（向量余弦优先，失败降级为中文 3-gram Jaccard），
 * 再用并查集合并疑似同源的来源，最后让大模型复核每个多人组。
 * 每条来源都会落到一个组里（无关来源单独成组），保证 groupId 完整。
 */
import pLimit from 'p-limit';
import { z } from 'zod';
import type { CaseEvent, Claim, Source, SourceGroup, Tier } from '../../types/case';
import { chatJSON, embed } from '../llm';

/** 余弦相似度阈值：向量可用时使用 */
const COSINE_THRESHOLD = 0.88;
/** 3-gram Jaccard 阈值：向量不可用时降级使用 */
const JACCARD_THRESHOLD = 0.45;
/** 少于 2 条成员的组不送模型复核 */
const MIN_REVIEW_SIZE = 2;
/** 同源复核并发上限；各疑点之间共享，避免串行等待。 */
const REVIEW_CONCURRENCY = 3;

const ReviewSchema = z.object({
  keep: z.array(z.string()),
  reason: z.string().trim().min(1),
});

const TIER_RANK: Record<Tier, number> = {
  official: 4,
  media: 3,
  self: 2,
  marketing: 1,
  unknown: 0,
};

const SAME_SOURCE_FALLBACK_REASON = '标题与摘要高度相似，疑似转载或洗稿，未能通过模型复核。';
const SINGLETON_REASON = '未发现同源转载，视为独立信源。';
const IRRELEVANT_REASON = '立场与疑点无关，单独成组。';

/** 外部依赖，测试可注入桩函数以保证结果可重复。 */
export type ClusterDeps = {
  embed: (texts: string[]) => Promise<number[][]>;
  review: (
    members: Source[],
    signal?: AbortSignal,
  ) => Promise<{ keep: string[]; reason: string }>;
};

const defaultDeps: ClusterDeps = {
  embed: (texts) => embed(texts),
  review: (members, signal) =>
    chatJSON({
      system: buildReviewPrompt(members),
      user: `请复核以上 ${members.length} 条来源是否同源。`,
      schema: ReviewSchema,
      temperature: 0.2,
      maxTokens: 2_000,
      timeoutMs: 60_000,
      ...(signal ? { signal } : {}),
    }),
};

/** 去掉空白与标点，避免标点差异影响 3-gram 重合度。 */
function cleanText(text: string): string {
  return text.replace(/[\s，。！？、；：""''（）()《》【】…—\-·!?.,;:'"()[\]<>|/\\]/g, '');
}

/** 中文按字符切 3-gram；不足 3 字时整串作为一个 gram。 */
function trigrams(text: string): Set<string> {
  const cleaned = cleanText(text);
  const grams = new Set<string>();
  if (!cleaned) {
    return grams;
  }
  if (cleaned.length <= 3) {
    grams.add(cleaned);
    return grams;
  }
  for (let index = 0; index <= cleaned.length - 3; index += 1) {
    grams.add(cleaned.slice(index, index + 3));
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 尝试生成向量；失败时打印日志并返回 null，由调用方降级为 Jaccard。 */
async function tryEmbed(
  texts: string[],
  embedTexts: ClusterDeps['embed'],
): Promise<number[][] | null> {
  if (texts.length < 2) {
    return null;
  }
  try {
    const vectors = await embedTexts(texts);
    if (vectors.length !== texts.length) {
      console.warn(
        `[cluster] 向量数量不匹配（期望 ${texts.length}，实际 ${vectors.length}），降级为 3-gram Jaccard`,
      );
      return null;
    }
    return vectors;
  } catch (error) {
    console.warn(`[cluster] 向量化失败，降级为 3-gram Jaccard：${(error as Error).message}`);
    return null;
  }
}

/** 同一疑点内的相似度矩阵判定：余弦命中或 Jaccard 命中都算疑似同源。 */
function similarPairs(list: Source[], vectors: number[][] | null): boolean[][] {
  const count = list.length;
  const result = Array.from({ length: count }, () => Array<boolean>(count).fill(false));
  if (count < 2) {
    return result;
  }

  const texts = list.map((source) => `${source.title}${source.snippet}`);
  const gramSets = texts.map((text) => trigrams(text));

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const byCosine = vectors ? cosine(vectors[i], vectors[j]) >= COSINE_THRESHOLD : false;
      const byJaccard = jaccard(gramSets[i], gramSets[j]) >= JACCARD_THRESHOLD;
      result[i][j] = byCosine || byJaccard;
      result[j][i] = result[i][j];
    }
  }
  return result;
}

class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    let current = index;
    while (this.parent[current] !== current) {
      const next = this.parent[current];
      this.parent[current] = root;
      current = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootB] = rootA;
    }
  }
}

/** 组内首发源：时间最早者；全部无时间时取 tier 最高者。 */
function pickOrigin(members: Source[]): Source {
  const timed = members
    .map((source) => ({ source, time: source.publishedAt ? Date.parse(source.publishedAt) : NaN }))
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time);

  if (timed.length > 0) {
    return timed[0].source;
  }

  return [...members].sort(
    (a, b) => TIER_RANK[b.tier ?? 'unknown'] - TIER_RANK[a.tier ?? 'unknown'],
  )[0];
}

function buildReviewPrompt(members: Source[]): string {
  const rows = members
    .map((source) =>
      [`id: ${source.id}`, `title: ${source.title}`, `snippet: ${source.snippet}`].join('\n'),
    )
    .join('\n\n');

  return `你是事实核查编辑，判断下列来源是否属于同一信源。

这些来源已通过文本相似度初筛（余弦 ≥ 0.88 或 3-gram Jaccard ≥ 0.45），默认按疑似同源处理。
只有能明确指出以下情况时，才把成员排除：各自有独立采访、独立数据、独立专家，或其实在讲不同事件。

同一信源指：转载、洗稿、摘编同一篇原文，或只是换个标题复述同一段内容。

来源：
${rows}

要求：
- keep：保留属于同一信源的来源 id；确认不属于的成员不要放进 keep；
- 除非有明确证据，否则保留初筛结果，不要仅因措辞差异拆分；
- reason：一句中文理由，说明判断依据，不超过 40 字。

只输出如下格式的 JSON 对象，不要 Markdown、注释或解释：
{"keep":["来源 id"],"reason":"一句理由"}`;
}

/** 让模型复核一个多人组；失败时保留原组并给出降级理由。 */
async function reviewGroup(
  members: Source[],
  emit: (event: CaseEvent) => void,
  review: ClusterDeps['review'],
  signal?: AbortSignal,
): Promise<{ kept: Source[]; reason: string }> {
  try {
    const result = await review(members, signal);

    const validIds = new Set(members.map((source) => source.id));
    const keepIds = new Set(result.keep.filter((id) => validIds.has(id)));
    const kept = members.filter((source) => keepIds.has(source.id));
    const reason = result.reason;

    if (kept.length < MIN_REVIEW_SIZE) {
      return { kept: [], reason };
    }
    return { kept, reason };
  } catch (error) {
    emit({
      type: 'error',
      message: `同源复核失败：${(error as Error).message}`,
      recoverable: true,
    });
    return { kept: members, reason: SAME_SOURCE_FALLBACK_REASON };
  }
}

type GroupDraft = {
  members: Source[];
  reason: string;
};

/** 对一个疑点下的来源做相似度聚类，返回未编号的分组草稿。 */
function clusterClaim(list: Source[], vectors: number[][] | null): GroupDraft[] {
  if (list.length === 0) {
    return [];
  }

  const matrix = similarPairs(list, vectors);
  const dsu = new DisjointSet(list.length);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (matrix[i][j]) {
        dsu.union(i, j);
      }
    }
  }

  const buckets = new Map<number, Source[]>();
  list.forEach((source, index) => {
    const root = dsu.find(index);
    const bucket = buckets.get(root) ?? [];
    bucket.push(source);
    buckets.set(root, bucket);
  });

  const drafts: GroupDraft[] = [];
  for (const members of buckets.values()) {
    if (members.length < MIN_REVIEW_SIZE) {
      drafts.push({ members, reason: SINGLETON_REASON });
      continue;
    }

    drafts.push({ members, reason: SAME_SOURCE_FALLBACK_REASON });
  }

  return drafts;
}

/** 输出组：成员顺序稳定，groupId 全局递增。 */
type PendingGroup = {
  claimId: string;
  sources: Source[];
  originSourceId: string;
  reason: string;
};

/** 按疑点分组、合并同源并推送事件，最后返回全部同源组。 */
export type ClusterOptions = {
  /** 软截止时间（epoch ms）；到点后不再发起新的模型复核。 */
  deadline?: number;
  /** 软超时取消信号，用于中止在途复核。 */
  signal?: AbortSignal;
};

export async function clusterSources(
  claims: Claim[],
  sources: Source[],
  emit: (event: CaseEvent) => void,
  deps: ClusterDeps = defaultDeps,
  options: ClusterOptions = {},
): Promise<SourceGroup[]> {
  if (sources.length === 0) {
    emit({ type: 'groups', groups: [] });
    return [];
  }

  const claimOrder: string[] = claims.map((claim) => claim.id);
  const byClaim = new Map<string, Source[]>();
  for (const source of sources) {
    const list = byClaim.get(source.claimId) ?? [];
    list.push(source);
    byClaim.set(source.claimId, list);
    if (!claimOrder.includes(source.claimId)) {
      claimOrder.push(source.claimId);
    }
  }

  const relevantByClaim = new Map<string, Source[]>();
  for (const claimId of claimOrder) {
    const list = byClaim.get(claimId) ?? [];
    relevantByClaim.set(
      claimId,
      list.filter((source) => source.stance !== 'irrelevant'),
    );
  }

  const deadline = options.deadline;
  const deadlineReached = (): boolean => deadline !== undefined && Date.now() >= deadline;

  // 所有疑点共用一次 embedding 批量请求；失败时整批降级为 3-gram Jaccard。
  const allTexts = claimOrder.flatMap((claimId) =>
    (relevantByClaim.get(claimId) ?? []).map((source) => `${source.title}${source.snippet}`),
  );
  const allVectors = deadlineReached() ? null : await tryEmbed(allTexts, deps.embed);
  const vectorsByClaim = new Map<string, number[][] | null>();
  let offset = 0;
  for (const claimId of claimOrder) {
    const count = relevantByClaim.get(claimId)?.length ?? 0;
    vectorsByClaim.set(claimId, allVectors ? allVectors.slice(offset, offset + count) : null);
    offset += count;
  }

  const reviewLimit = pLimit(REVIEW_CONCURRENCY);

  // 各疑点并行聚类与复核；最终仍按 claimOrder 顺序拼接，保证 groupId 稳定。
  const perClaim = await Promise.all(
    claimOrder.map(async (claimId) => {
      const list = byClaim.get(claimId) ?? [];
      const relevant = relevantByClaim.get(claimId) ?? [];
      const groups: PendingGroup[] = list
        .filter((source) => source.stance === 'irrelevant')
        .map((source) => ({
          claimId,
          sources: [source],
          originSourceId: source.id,
          reason: IRRELEVANT_REASON,
        }));

      const drafts = clusterClaim(relevant, vectorsByClaim.get(claimId) ?? null);
      const reviewed = await Promise.all(
        drafts.map(async (draft) => {
          if (draft.members.length < MIN_REVIEW_SIZE) {
            return { draft, kept: draft.members, reason: SINGLETON_REASON };
          }
          // 软超时后不再发起新的复核，保留相似度初筛结果。
          if (deadlineReached()) {
            return { draft, kept: draft.members, reason: SAME_SOURCE_FALLBACK_REASON };
          }
          const result = await reviewLimit(() =>
            reviewGroup(draft.members, emit, deps.review, options.signal),
          );
          return { draft, ...result };
        }),
      );

      for (const { draft, kept, reason } of reviewed) {
        if (kept.length < MIN_REVIEW_SIZE) {
          // 单成员或复核后不足两条：全部拆成独立组
          for (const source of draft.members) {
            groups.push({
              claimId,
              sources: [source],
              originSourceId: source.id,
              reason: SINGLETON_REASON,
            });
          }
          continue;
        }

        const keptIds = new Set(kept.map((source) => source.id));
        groups.push({
          claimId,
          sources: kept,
          originSourceId: pickOrigin(kept).id,
          reason,
        });
        for (const source of draft.members) {
          if (!keptIds.has(source.id)) {
            groups.push({
              claimId,
              sources: [source],
              originSourceId: source.id,
              reason: SINGLETON_REASON,
            });
          }
        }
      }

      return groups;
    }),
  );

  const pending = perClaim.flat();
  const groups: SourceGroup[] = pending.map((item, index) => ({
    id: `g${index + 1}`,
    claimId: item.claimId,
    originSourceId: item.originSourceId,
    memberIds: item.sources.map((source) => source.id),
    reason: item.reason,
  }));

  for (const group of groups) {
    for (const id of group.memberIds) {
      emit({
        type: 'source_update',
        id,
        patch: { groupId: group.id, isOrigin: id === group.originSourceId },
      });
    }
  }

  emit({ type: 'groups', groups });
  return groups;
}

/** 独立信源数：排除成员全部为 irrelevant 的组。 */
export function countIndependent(groups: SourceGroup[], sources: Source[] = []): number {
  if (sources.length === 0) {
    return groups.filter((group) => group.memberIds.length > 0).length;
  }

  const byId = new Map(sources.map((source) => [source.id, source]));
  return groups.filter((group) => {
    if (group.memberIds.length === 0) {
      return false;
    }
    return !group.memberIds.every((id) => byId.get(id)?.stance === 'irrelevant');
  }).length;
}

/**
 * 流水线第三步：来源分级。
 * 按疑点分批让大模型判断 stance；域名清单能识别的 tier 不交给模型。
 */
import { z } from 'zod';
import {
  StanceSchema,
  TierSchema,
  type CaseEvent,
  type Claim,
  type Source,
  type Tier,
} from '../../types/case';
import { chatJSON } from '../llm';
import { tierByDomain } from '../tiers';

const BATCH_SIZE = 8;

const GradeItemSchema = z.object({
  id: z.string(),
  stance: StanceSchema,
  tier: TierSchema.optional(),
  reason: z.string().trim().min(1),
});

const GradeResultSchema = z.object({
  results: z.array(GradeItemSchema),
});

type Grade = {
  stance: z.infer<typeof StanceSchema>;
  tier: Tier;
};

type Batch = {
  claimText: string;
  items: Source[];
};

function buildBatches(claims: Claim[], sources: Source[]): Batch[] {
  const claimTexts = new Map(claims.map((claim) => [claim.id, claim.text]));
  const byClaim = new Map<string, Source[]>();

  for (const source of sources) {
    const list = byClaim.get(source.claimId) ?? [];
    list.push(source);
    byClaim.set(source.claimId, list);
  }

  const claimIds = [...claims.map((claim) => claim.id)];
  for (const claimId of byClaim.keys()) {
    if (!claimTexts.has(claimId)) {
      claimIds.push(claimId);
    }
  }

  const batches: Batch[] = [];
  for (const claimId of claimIds) {
    const list = byClaim.get(claimId) ?? [];
    for (let start = 0; start < list.length; start += BATCH_SIZE) {
      batches.push({
        claimText: claimTexts.get(claimId) ?? '',
        items: list.slice(start, start + BATCH_SIZE),
      });
    }
  }
  return batches;
}

function buildPrompt(batch: Batch): string {
  const rows = batch.items
    .map((source) => {
      const knownTier = tierByDomain(source.url) ?? tierByDomain(source.site);
      return [
        `id: ${source.id}`,
        `title: ${source.title}`,
        `snippet: ${source.snippet}`,
        `site: ${source.site}`,
        `url: ${source.url}`,
        `trustedTier: ${knownTier ?? 'null'}`,
      ].join('\n');
    })
    .join('\n\n');

  return `你是事实核查编辑，判断每条来源对疑点的立场与可信度。

疑点：${batch.claimText || '（未提供疑点文本）'}

对每条来源：
- stance：
  - support：标题或摘要明确支持疑点；
  - refute：标题或摘要明确否定疑点，包括辟谣、纠错、澄清；辟谣文章即使引述谣言原文，也算 refute；
  - irrelevant：只是相关、可能有关、背景介绍、答非所问，或信息不足以判断。
- 只依据 title 和 snippet 判断，不要脑补正文；“可能有关”不等于“证实”。
- tier：trustedTier 不为 null 时原样返回该值；为 null 时才由你从 official / media / self / marketing / unknown 中判断。
- reason：一句中文理由，不超过 40 字。

来源：
${rows}

只输出如下格式的 JSON 对象，不要 Markdown、注释或解释：
{"results":[{"id":"来源 id","stance":"support|refute|irrelevant","tier":"official|media|self|marketing|unknown","reason":"一句理由"}]}`;
}

async function gradeBatch(
  batch: Batch,
  emit: (event: CaseEvent) => void,
): Promise<Map<string, Grade>> {
  const knownTiers = new Map(
    batch.items.map((source) => [source.id, tierByDomain(source.url) ?? tierByDomain(source.site)]),
  );

  try {
    const result = await chatJSON({
      system: buildPrompt(batch),
      user: `请判断以上 ${batch.items.length} 条来源。`,
      schema: GradeResultSchema,
      temperature: 0,
      timeoutMs: 60_000,
    });

    const grades = new Map<string, Grade>();
    for (const item of result.results) {
      if (!knownTiers.has(item.id)) {
        continue;
      }
      grades.set(item.id, {
        stance: item.stance,
        tier: knownTiers.get(item.id) ?? item.tier ?? 'unknown',
      });
    }

    for (const source of batch.items) {
      if (!grades.has(source.id)) {
        grades.set(source.id, {
          stance: 'irrelevant',
          tier: knownTiers.get(source.id) ?? 'unknown',
        });
      }
    }
    return grades;
  } catch (error) {
    emit({
      type: 'error',
      message: `来源分级失败：${(error as Error).message}`,
      recoverable: true,
    });
    return new Map(
      batch.items.map((source) => [
        source.id,
        { stance: 'irrelevant' as const, tier: knownTiers.get(source.id) ?? 'unknown' },
      ]),
    );
  }
}

/** 按疑点分批并行分级；irrelevant 的来源保留，交由后续阶段跳过。 */
export async function gradeSources(
  claims: Claim[],
  sources: Source[],
  emit: (event: CaseEvent) => void,
): Promise<Source[]> {
  if (sources.length === 0) {
    return [];
  }

  const batches = buildBatches(claims, sources);
  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const grades = await gradeBatch(batch, emit);
      for (const source of batch.items) {
        const grade = grades.get(source.id);
        if (grade) {
          emit({
            type: 'source_update',
            id: source.id,
            patch: { stance: grade.stance, tier: grade.tier },
          });
        }
      }
      return grades;
    }),
  );

  const merged = new Map<string, Grade>();
  for (const grades of batchResults) {
    for (const [id, grade] of grades) {
      merged.set(id, grade);
    }
  }

  return sources.map((source) => {
    const grade = merged.get(source.id);
    return grade ? { ...source, stance: grade.stance, tier: grade.tier } : source;
  });
}

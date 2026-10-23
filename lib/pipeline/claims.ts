/**
 * 流水线第一步：疑点拆解。
 * 把用户输入拆成 1–5 个可独立验证的事实性陈述。
 */
import { z } from 'zod';
import { ClaimSchema, type Claim } from '../../types/case';
import { chatJSON } from '../llm';

const MAX_CLAIMS = 5;
const DEMO_MAX_CLAIMS = 3;

function claimLimit(): number {
  return process.env.USE_MOCK === 'true' ? DEMO_MAX_CLAIMS : MAX_CLAIMS;
}

function buildSystemPrompt(limit: number): string {
  const mode = limit < MAX_CLAIMS ? `（当前为演示模式）` : '';
  return `你是事实核查编辑。把用户输入拆成 1–${limit} 个可独立验证的事实性陈述。

要求：
1. 只保留事实性陈述，忽略情绪、观点、评价和号召转发。
2. 每条改写为中性、具体、可搜索的陈述句，保留关键人物、时间、数字、因果。
3. kind 从 person/time/number/causal/other 中选：
   - person：人物身份、经历、言论；
   - time：时间、年代、先后顺序；
   - number：数量、比例、金额等数字；
   - causal：因果关系；
   - other：其他事实。
4. 输入整体只是一个事实时只输出 1 条；一句话含多个可独立判断的事实时要拆成多条；不含可核查事实时输出空数组。
5. 因果拆分规则：
   - 输入是「A 是因为 B」「B 导致 A」这类因果句，且 A 和 B 各自都能单独查证时，拆成 3 条：A（事实）、B（事实）、「B 是 A 的原因」（kind=causal）。
   - A 或 B 本身无法单独查证（例如只是情绪或观点）时不要拆，整句作为 1 条 causal。
   - 拆出的陈述保留原话的范围词，不得自行补充或改动（例如「至今没有被挖掘」就照原样写，不要改成「主墓未被发掘」）；范围上的偏差留给判决阶段指出。
6. 疑点总数不超过 ${limit} 条${mode}；超出时优先保留 causal 那条，以及最核心的事实。

只输出如下格式的 JSON 对象，不要 Markdown、注释或解释：
{"claims":[{"text":"中性陈述句","kind":"other"}]}
没有可核查事实时输出：{"claims":[]}`;
}

const ClaimDraftSchema = z.object({
  text: z.string().trim().min(1),
  kind: z.enum(['person', 'time', 'number', 'causal', 'other']),
});

const ClaimDraftListSchema = z.object({
  claims: z.array(ClaimDraftSchema).max(MAX_CLAIMS),
});

type ClaimDraft = z.infer<typeof ClaimDraftSchema>;

/** 超出上限时优先保留 causal，再按原顺序补足核心事实。 */
function capDrafts(drafts: ClaimDraft[], limit: number): ClaimDraft[] {
  if (drafts.length <= limit) {
    return drafts;
  }

  const kept = new Set<ClaimDraft>();
  for (const item of drafts) {
    if (item.kind === 'causal' && kept.size < limit) {
      kept.add(item);
    }
  }
  for (const item of drafts) {
    if (kept.size >= limit) {
      break;
    }
    kept.add(item);
  }
  return drafts.filter((item) => kept.has(item));
}

/** 拆解输入中的可核查疑点；无事实时返回空数组。 */
export async function extractClaims(input: string): Promise<Claim[]> {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const limit = claimLimit();
  const result = await chatJSON({
    system: buildSystemPrompt(limit),
    user: trimmed,
    schema: ClaimDraftListSchema,
    temperature: 0,
    // 推理型模型首字延迟较高，给足时间避免默认 20 秒超时
    timeoutMs: 60_000,
  });

  return ClaimSchema.array().parse(
    capDrafts(result.claims, limit).map((item, index) => ({
      id: `c${index + 1}`,
      text: item.text,
      kind: item.kind,
    })),
  );
}

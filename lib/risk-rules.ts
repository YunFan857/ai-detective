import type { RiskLevel } from '../types/case';

/** 调用方可覆盖各组关键词，不修改共享契约。 */
export const DEFAULT_RISK_TERMS = {
  compliance: [
    '英烈',
    '烈士',
    '红军',
    '长征',
    '党史',
    '抗日',
    '民族',
    '宗教',
    '毛泽东',
    '毛主席',
    '周恩来',
    '周总理',
    '朱德',
    '邓小平',
    '习近平',
    '总书记',
    '国家主席',
    '党中央',
  ],
  secret: ['鲜为人知', '真相是', '史书不敢写', '其实', '竟然'],
  absolute: ['唯一', '第一', '史上最', '从未', '绝无仅有', '绝对', '从来没有'],
  causal: ['因为', '导致', '所以', '正是由于', '全靠', '只因'],
} satisfies Record<string, readonly string[]>;

export type RiskTerms = { [K in keyof typeof DEFAULT_RISK_TERMS]: readonly string[] };
export const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

export function applyRiskRules(
  claim: { sentence: string; signals: string[]; riskLevel: RiskLevel; category: string },
  terms: RiskTerms = DEFAULT_RISK_TERMS,
): { signals: string[]; riskLevel: RiskLevel } {
  const signals = new Set(claim.signals);
  const matches = (words: readonly string[]) => words.some((word) => claim.sentence.includes(word));
  const compliance = matches(terms.compliance) || signals.has('合规敏感');
  const secret = matches(terms.secret);
  const absolute = matches(terms.absolute);
  const precise =
    /\d+(?:[.,，]\d+)*(?:%|％|年|月|日|万|亿|人|次|米|公里|天|小时|元)?/u.test(claim.sentence) ||
    /[一二三四五六七八九十百千万亿两]+(?:年|月|日|人|次|里|米|天|万|亿)/u.test(claim.sentence);
  const quote = claim.category === 'quote' || /(?:说过|曾说|名言|曾言)/u.test(claim.sentence);
  if (compliance) signals.add('合规敏感');
  if (secret) signals.add('秘闻句式');
  if (absolute) signals.add('绝对化表述');
  if (precise) signals.add('精确数字');
  if (quote) signals.add('名人名言');
  if (matches(terms.causal)) signals.add('强因果');
  const strong = [...signals].some((signal) => /名人名言|精确数字|绝对化|秘闻/u.test(signal));
  const suspicious = [...signals].some((signal) => signal !== '合规敏感');
  const ruleRisk: RiskLevel =
    strong || (compliance && suspicious) ? 'high' : compliance || suspicious ? 'medium' : 'low';
  return {
    signals: [...signals],
    riskLevel: RISK_ORDER[ruleRisk] < RISK_ORDER[claim.riskLevel] ? ruleRisk : claim.riskLevel,
  };
}

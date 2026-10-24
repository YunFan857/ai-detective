import type { Claim, Stance, Stage, Tier, VerdictLevel } from '@/types/case';

/**
 * 枚举 → 中文与配色的唯一映射。
 * 组件里只从这里取文案和 class，不再各自写一份 Record。
 */

export type ToneMeta = {
  label: string;
  /** 浅色底 */
  bg: string;
  /** 底色上的文字色 */
  text: string;
  /** 描边色 */
  border: string;
  /** 实心色块 */
  solid: string;
  /** 小圆点 */
  dot: string;
};

export const TIER_META: Record<Tier, ToneMeta> = {
  official: {
    label: '官方/学术',
    bg: 'bg-tier-official-soft',
    text: 'text-brand-dark',
    border: 'border-tier-official',
    solid: 'bg-tier-official',
    dot: 'bg-tier-official',
  },
  media: {
    label: '权威媒体',
    bg: 'bg-tier-media-soft',
    text: 'text-blue',
    border: 'border-tier-media',
    solid: 'bg-tier-media',
    dot: 'bg-tier-media',
  },
  self: {
    label: '自媒体',
    bg: 'bg-tier-self-soft',
    text: 'text-orange',
    border: 'border-tier-self',
    solid: 'bg-tier-self',
    dot: 'bg-tier-self',
  },
  marketing: {
    label: '营销号',
    bg: 'bg-tier-marketing-soft',
    text: 'text-gray',
    border: 'border-tier-marketing',
    solid: 'bg-tier-marketing',
    dot: 'bg-tier-marketing',
  },
  unknown: {
    label: '未知',
    bg: 'bg-tier-unknown-soft',
    text: 'text-gray',
    border: 'border-tier-unknown',
    solid: 'bg-tier-unknown',
    dot: 'bg-tier-unknown',
  },
};

export const VERDICT_META: Record<VerdictLevel, ToneMeta> = {
  true: {
    label: '属实',
    bg: 'bg-verdict-true-soft',
    text: 'text-brand-dark',
    border: 'border-verdict-true',
    solid: 'bg-verdict-true',
    dot: 'bg-verdict-true',
  },
  partly_true: {
    label: '部分属实',
    bg: 'bg-verdict-partly-true-soft',
    text: 'text-orange',
    border: 'border-verdict-partly-true',
    solid: 'bg-verdict-partly-true',
    dot: 'bg-verdict-partly-true',
  },
  out_of_context: {
    label: '断章取义',
    bg: 'bg-verdict-out-of-context-soft',
    text: 'text-orange',
    border: 'border-verdict-out-of-context',
    solid: 'bg-verdict-out-of-context',
    dot: 'bg-verdict-out-of-context',
  },
  unverified: {
    label: '无法证实',
    bg: 'bg-verdict-unverified-soft',
    text: 'text-gray',
    border: 'border-verdict-unverified',
    solid: 'bg-verdict-unverified',
    dot: 'bg-verdict-unverified',
  },
  false: {
    label: '谣言',
    bg: 'bg-verdict-false-soft',
    text: 'text-red',
    border: 'border-verdict-false',
    solid: 'bg-verdict-false',
    dot: 'bg-verdict-false',
  },
};

export const STAGE_META: Record<Stage, ToneMeta & { index: number }> = {
  claims: {
    index: 1,
    label: '拆解疑点',
    bg: 'bg-brand-soft',
    text: 'text-brand-dark',
    border: 'border-brand',
    solid: 'bg-brand',
    dot: 'bg-brand',
  },
  search: {
    index: 2,
    label: '正反搜证',
    bg: 'bg-blue-soft',
    text: 'text-blue',
    border: 'border-blue',
    solid: 'bg-blue',
    dot: 'bg-blue',
  },
  grade: {
    index: 3,
    label: '来源分级',
    bg: 'bg-orange-soft',
    text: 'text-orange',
    border: 'border-orange',
    solid: 'bg-orange',
    dot: 'bg-orange',
  },
  cluster: {
    index: 4,
    label: '同源合并',
    bg: 'bg-gray-soft',
    text: 'text-gray',
    border: 'border-gray',
    solid: 'bg-gray',
    dot: 'bg-gray',
  },
  trace: {
    index: 5,
    label: '溯源时间线',
    bg: 'bg-blue-soft',
    text: 'text-blue',
    border: 'border-blue',
    solid: 'bg-blue',
    dot: 'bg-blue',
  },
  verdict: {
    index: 6,
    label: '五档判决',
    bg: 'bg-brand-soft',
    text: 'text-brand-dark',
    border: 'border-brand',
    solid: 'bg-brand',
    dot: 'bg-brand',
  },
};

export const STANCE_LABELS: Record<Stance, string> = {
  support: '支持',
  refute: '反驳',
  irrelevant: '无关',
};

export const CLAIM_KIND_LABELS: Record<Claim['kind'], string> = {
  person: '人物',
  time: '时间',
  number: '数字',
  causal: '因果',
  other: '其他',
};

export const DIRECTION_LABELS = {
  pro: '正方',
  con: '反方',
} as const;

export function tierLabel(tier: Tier): string {
  return TIER_META[tier].label;
}

export function verdictLabel(level: VerdictLevel): string {
  return VERDICT_META[level].label;
}

export function stageLabel(stage: Stage): string {
  return STAGE_META[stage].label;
}

export function stanceLabel(stance: Stance): string {
  return STANCE_LABELS[stance];
}

export function claimKindLabel(kind: Claim['kind']): string {
  return CLAIM_KIND_LABELS[kind];
}

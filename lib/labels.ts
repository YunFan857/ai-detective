import type { Claim, Source, Stance, Stage, Tier, VerdictLevel } from '@/types/case';

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

/** 判决印章的爆炸底色，与五档判决色一一对应。 */
export const VERDICT_STAMP_FILL: Record<VerdictLevel, string> = {
  true: 'fill-verdict-true',
  partly_true: 'fill-verdict-partly-true',
  out_of_context: 'fill-verdict-out-of-context',
  unverified: 'fill-verdict-unverified',
  false: 'fill-verdict-false',
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

/** 疑点风险等级：拆疑点确认页用来提示先查哪几条。 */
export const RISK_META: Record<NonNullable<Claim['riskLevel']>, ToneMeta> = {
  high: {
    label: '高风险',
    bg: 'bg-red-soft',
    text: 'text-red',
    border: 'border-red',
    solid: 'bg-red',
    dot: 'bg-red',
  },
  medium: {
    label: '中风险',
    bg: 'bg-orange-soft',
    text: 'text-orange',
    border: 'border-orange',
    solid: 'bg-orange',
    dot: 'bg-orange',
  },
  low: {
    label: '低风险',
    bg: 'bg-gray-soft',
    text: 'text-gray',
    border: 'border-gray',
    solid: 'bg-gray',
    dot: 'bg-gray',
  },
};

export const DIRECTION_LABELS = {
  pro: '正方',
  con: '反方',
} as const;

/** 站点名缺失时退回域名；域名也取不到时显示「来源不详」。 */
export function siteLabel(site: string | undefined, url?: string): string {
  const trimmed = site?.trim();
  if (trimmed) return trimmed;

  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '');
      if (host) return host;
    } catch {
      // 非法链接按缺失处理
    }
  }

  return '来源不详';
}

/** 来源卡片统一取站点名：空站点名用域名兜底。 */
export function sourceSiteLabel(source: Pick<Source, 'site' | 'url'>): string {
  return siteLabel(source.site, source.url);
}

/** 标题缺失或只有空白时统一占位。 */
export function sourceTitleLabel(source: Pick<Source, 'title'>): string {
  return source.title.trim() || '暂无标题';
}

/** 摘要缺失时退回标题，再退回占位。 */
export function sourceSnippetLabel(source: Pick<Source, 'snippet' | 'title'>): string {
  return source.snippet.trim() || source.title.trim() || '暂无摘要';
}

/** ISO 时间格式化；缺失或无法解析统一显示「时间不详」。 */
export function formatSourceTime(
  publishedAt: string | undefined,
  precision: 'year' | 'month' | 'day',
): string {
  if (!publishedAt) return '时间不详';

  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) return '时间不详';

  const date = new Date(timestamp);
  const year = String(date.getUTCFullYear());
  if (precision === 'year') return year;

  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  if (precision === 'month') return `${year}-${month}`;

  return `${year}-${month}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** 长文本截断，用于 title 属性等无法使用 line-clamp 的位置。 */
export function clipText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

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

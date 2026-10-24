import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';
import type { Tier } from '@/types/case';
import { TIER_META } from '@/lib/labels';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tier: Tier;
  showDot?: boolean;
};

/** 来源等级徽章：官方/学术、权威媒体、自媒体、营销号、未知。 */
export function Badge({ tier, showDot = true, className, ...props }: BadgeProps) {
  const meta = TIER_META[tier];

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border-2 px-2.5 py-0.5 text-[11px] font-black tracking-wide',
        meta.bg,
        meta.text,
        meta.border,
        className,
      )}
      {...props}
    >
      {showDot ? <i className={clsx('h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden /> : null}
      {meta.label}
    </span>
  );
}

import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';
import type { VerdictLevel } from '@/types/case';
import { VERDICT_META } from '@/lib/labels';

type VerdictBadgeSize = 'sm' | 'md';

const SIZE_CLASSES: Record<VerdictBadgeSize, string> = {
  sm: 'border-2 px-2 py-0.5 text-[11px]',
  md: 'border-[3px] px-3 py-1 text-sm shadow-ink-sm',
};

type VerdictBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  level: VerdictLevel;
  size?: VerdictBadgeSize;
};

/** 五档判决徽章：属实、部分属实、断章取义、无法证实、谣言。 */
export function VerdictBadge({
  level,
  size = 'md',
  className,
  ...props
}: VerdictBadgeProps) {
  const meta = VERDICT_META[level];

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg font-black tracking-wide',
        meta.bg,
        meta.text,
        meta.border,
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      <i className={clsx('h-2 w-2 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

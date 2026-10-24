import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export type StickerTone = 'brand' | 'orange' | 'red' | 'blue' | 'gray' | 'white';

const TONE_CLASSES: Record<StickerTone, string> = {
  brand: 'bg-brand text-white',
  orange: 'bg-orange text-white',
  red: 'bg-red text-white',
  blue: 'bg-blue text-white',
  gray: 'bg-gray text-white',
  white: 'bg-card text-ink',
};

type StickerProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StickerTone;
  rotate?: number;
  children: ReactNode;
};

/** 歪贴标签：2px 黑描边 + 小硬投影，默认微微歪斜。 */
export function Sticker({
  tone = 'white',
  rotate = -4,
  className,
  children,
  style,
  ...props
}: StickerProps) {
  return (
    <span
      className={clsx(
        'inline-block rounded-md border-2 border-ink px-2.5 py-1 text-xs font-black tracking-wide shadow-ink-sm',
        TONE_CLASSES[tone],
        className,
      )}
      style={{ ...style, transform: `rotate(${rotate}deg)` }}
      {...props}
    >
      {children}
    </span>
  );
}

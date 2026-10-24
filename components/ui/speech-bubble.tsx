import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export type BubbleTone = 'white' | 'brand' | 'ink';
export type BubbleTail = 'left' | 'right' | 'bottom' | 'none';

const TONE_CLASSES: Record<BubbleTone, { box: string; tail: string }> = {
  white: { box: 'bg-card text-ink', tail: 'fill-card' },
  brand: { box: 'bg-brand text-white', tail: 'fill-brand' },
  ink: { box: 'bg-ink text-white', tail: 'fill-ink' },
};

const TAIL_CLASSES: Record<Exclude<BubbleTail, 'none'>, string> = {
  left: '-left-[15px] top-5 rotate-90',
  right: '-right-[15px] top-5 -rotate-90',
  bottom: 'left-8 -bottom-[10px]',
};

type SpeechBubbleProps = HTMLAttributes<HTMLDivElement> & {
  tone?: BubbleTone;
  tail?: BubbleTail;
  children: ReactNode;
};

/** 对白气泡：3px 黑描边 + 硬投影，尾巴方向可选。 */
export function SpeechBubble({
  tone = 'white',
  tail = 'bottom',
  className,
  children,
  ...props
}: SpeechBubbleProps) {
  return (
    <div
      className={clsx(
        'relative inline-block rounded-2xl border-[3px] border-ink px-4 py-3 text-sm font-bold shadow-ink-sm',
        TONE_CLASSES[tone].box,
        className,
      )}
      {...props}
    >
      {children}
      {tail === 'none' ? null : (
        <svg
          viewBox="0 0 20 12"
          aria-hidden
          className={clsx(
            'pointer-events-none absolute h-3 w-5 overflow-visible',
            TAIL_CLASSES[tail],
          )}
        >
          <path
            d="M1 0 L19 0 L10 12 Z"
            className={TONE_CLASSES[tone].tail}
            stroke="var(--color-ink)"
            strokeWidth="2"
          />
        </svg>
      )}
    </div>
  );
}

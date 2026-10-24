import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export type ComicCardTone = 'white' | 'mint' | 'ink';

const TONE_CLASSES: Record<ComicCardTone, string> = {
  white: 'comic-card text-ink',
  mint: 'comic-card-green bg-brand-soft text-ink',
  ink: 'comic-card bg-ink text-white',
};

type ComicCardProps = HTMLAttributes<HTMLDivElement> & {
  tone?: ComicCardTone;
  children: ReactNode;
};

/** 漫画卡片：白 / 薄荷绿 / 墨黑三种底，统一 3px 黑描边与硬投影。 */
export function ComicCard({ tone = 'white', className, children, ...props }: ComicCardProps) {
  return (
    <div className={clsx(TONE_CLASSES[tone], className)} {...props}>
      {children}
    </div>
  );
}

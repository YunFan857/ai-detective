import type { ReactNode } from 'react';
import { ComicButton } from '@/components/ui/comic-button';
import { DetectiveMascot } from '@/components/ui/detective-mascot';

export type ClaimsStateCardProps = {
  mood?: 'default' | 'yawn';
  eyebrow: string;
  title: string;
  description: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  detail?: string;
};

/** 文案体检的空状态 / 失败 / 缺失交接共用卡片。 */
export function ClaimsStateCard({
  mood = 'default',
  eyebrow,
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  detail,
}: ClaimsStateCardProps) {
  return (
    <div className="mx-auto grid w-full max-w-[1440px] px-3 py-8">
      <section className="comic-card mx-auto w-full max-w-[520px] px-6 py-8 text-center sm:px-10">
        <DetectiveMascot className="mx-auto w-[96px] -rotate-3" mood={mood} />

        <p className="mt-4 text-xs font-black tracking-wide text-muted">{eyebrow}</p>
        <h1 className="mt-2 text-xl leading-snug font-black text-ink">{title}</h1>
        <div className="mt-2 text-sm leading-6 font-bold text-muted">{description}</div>
        {detail ? (
          <p className="mt-2 break-words text-xs font-bold text-muted/80">{detail}</p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <ComicButton variant="brand" onClick={onPrimary}>
            {primaryLabel}
          </ComicButton>
          {secondaryLabel && onSecondary ? (
            <ComicButton variant="white" size="sm" onClick={onSecondary}>
              {secondaryLabel}
            </ComicButton>
          ) : null}
        </div>
      </section>
    </div>
  );
}

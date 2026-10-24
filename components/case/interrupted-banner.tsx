'use client';

import { ComicButton } from '@/components/ui/comic-button';

export type InterruptedBannerProps = {
  /** 中断原因，展示在「线索中断」下方。 */
  message: string;
  onRetry: () => void;
};

/** 顶部黄色横幅：网络断开或事件流意外结束时保留已收到内容，并允许重新调查。 */
export function InterruptedBanner({ message, onRetry }: InterruptedBannerProps) {
  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b-[3px] border-ink bg-highlight px-4 py-2"
    >
      <span aria-hidden className="text-lg">
        ⚠️
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-ink">线索中断</p>
        <p className="truncate text-xs font-bold text-ink/75">
          {message}，已收到的内容已保留。
        </p>
      </div>

      <ComicButton variant="white" size="sm" onClick={onRetry} className="shrink-0">
        🔁 重新调查
      </ComicButton>
    </div>
  );
}

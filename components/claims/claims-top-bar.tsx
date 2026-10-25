'use client';

import Link from 'next/link';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { useCredits } from '@/lib/credits';

export type ClaimsTopBarProps = {
  /** 右侧流程状态，如「找疑点」「找到 7 个疑点」。 */
  badge: string;
};

/** 文案体检页顶栏：品牌、当前流程状态、两种业务模式与积分说明。 */
export function ClaimsTopBar({ badge }: ClaimsTopBarProps) {
  const credits = useCredits();

  return (
    <div className="mx-auto w-full max-w-[1440px] px-3 pt-3">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border-[3px] border-ink bg-brand px-3 py-2 text-white shadow-ink-sm sm:gap-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-1.5 rounded-full border-2 border-white/60 px-2 py-1 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <DetectiveMascot
            variant="avatar"
            className="h-7 w-7 rounded-full border-2 border-ink bg-brand-soft object-contain"
          />
          <span className="text-base font-black tracking-wide whitespace-nowrap [text-shadow:1.5px_1.5px_0_var(--color-ink)]">
            AI 侦探社!
          </span>
        </Link>

        <span
          role="status"
          className="rounded-full border-2 border-ink bg-beige px-2.5 py-1 text-xs font-black whitespace-nowrap text-ink"
        >
          {badge}
        </span>

        <nav aria-label="业务模式" className="ml-auto flex items-center gap-1.5">
          <Link
            href="/"
            className="rounded-full border-2 border-white/60 px-3 py-1 text-xs font-black whitespace-nowrap text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            消息查证
          </Link>
          <span
            aria-current="page"
            className="rounded-full border-2 border-ink bg-card px-3 py-1 text-xs font-black whitespace-nowrap text-ink"
          >
            文案体检
          </span>
        </nav>

        <Link
          href="/credits"
          title="查看本地演示积分与签到"
          className="rounded-full border-2 border-white/60 px-3 py-1 text-xs font-black whitespace-nowrap text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {credits.status === 'ready' ? `${credits.balance} 积分 · 本地演示` : '积分读取中…'}
        </Link>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { ArrowLeft, Wallet } from 'lucide-react';
import { DetectiveMascot } from '@/components/ui/detective-mascot';

export type CreditsTopBarProps = {
  balance: number | null;
  loading: boolean;
};

/** 积分中心顶栏：品牌、页面身份与本地余额。 */
export function CreditsTopBar({ balance, loading }: CreditsTopBarProps) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-3 pt-3">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border-[3px] border-ink bg-brand px-3 py-2 text-white shadow-ink-sm sm:gap-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-1.5 rounded-full border-2 border-white/60 px-2 py-1 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <DetectiveMascot
            variant="avatar"
            className="h-8 w-8 rounded-full border-2 border-ink bg-brand-soft object-contain"
          />
          <span className="text-base font-black tracking-wide whitespace-nowrap [text-shadow:1.5px_1.5px_0_var(--color-ink)]">
            AI 侦探社!
          </span>
        </Link>

        <span className="rounded-full border-2 border-ink bg-beige px-3 py-1 text-xs font-black whitespace-nowrap text-ink">
          积分中心 · 购买积分
        </span>

        <span
          role="status"
          aria-live="polite"
          className="ml-auto flex items-center gap-1.5 rounded-full border-2 border-ink bg-card px-3 py-1 text-xs font-black whitespace-nowrap text-ink shadow-ink-sm"
        >
          <Wallet className="h-3.5 w-3.5 text-brand-dark" aria-hidden />
          {loading ? '积分读取中…' : `${balance ?? 0} 积分`}
        </span>

        <Link
          href="/"
          className="flex items-center gap-1 rounded-full border-2 border-white/60 px-3 py-1 text-xs font-black whitespace-nowrap text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          返回首页
        </Link>
      </div>
    </div>
  );
}

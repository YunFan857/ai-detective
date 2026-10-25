'use client';

import { Info, X } from 'lucide-react';
import { CreditsBalanceCard } from '@/components/credits/credits-balance-card';
import { CreditsCheckout } from '@/components/credits/credits-checkout';
import { CreditsFooter } from '@/components/credits/credits-footer';
import { CreditsPackages } from '@/components/credits/credits-packages';
import { CreditsTopBar } from '@/components/credits/credits-top-bar';
import { useCreditsCenter } from '@/lib/use-credits-center';

/** /credits 的拼装层：页面本身不写业务状态，全部在 useCreditsCenter。 */
export function CreditsWorkspace() {
  const ctl = useCreditsCenter();
  const loading = ctl.account.status === 'loading';

  return (
    <div className="paper-bg min-h-dvh">
      <CreditsTopBar balance={loading ? null : ctl.account.balance} loading={loading} />

      <div className="mx-auto w-full max-w-[1440px] px-3 pt-3">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink bg-beige px-3 py-2">
          <Info className="h-4 w-4 shrink-0 text-tangerine" aria-hidden />
          <p className="min-w-0 flex-1 text-[11px] leading-5 font-bold text-ink">
            演示积分 · 仅保存在当前浏览器 · 不支持真实支付
            <span className="ml-1 font-bold text-muted">
              签到、套餐与流水都是本地演示，不会产生真实订单或付款。
            </span>
          </p>
        </div>

        {ctl.notice ? (
          <div
            role="status"
            aria-live="polite"
            className={`mt-2 flex items-start gap-2 rounded-xl border-2 px-3 py-2 text-[11px] leading-5 font-black ${
              ctl.notice.tone === 'error'
                ? 'border-coral bg-coral-soft text-coral'
                : ctl.notice.tone === 'info'
                  ? 'border-blue bg-blue-soft text-blue'
                  : 'border-brand bg-brand-soft text-brand-dark'
            }`}
          >
            <span className="min-w-0 flex-1">{ctl.notice.text}</span>
            <button
              type="button"
              onClick={ctl.dismissNotice}
              aria-label="关闭提示"
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-start gap-3 px-3 py-3 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(280px,320px)]">
        <div className="min-w-0">
          <CreditsBalanceCard account={ctl.account} onCheckIn={ctl.checkIn} />
        </div>
        <div className="min-w-0">
          <CreditsPackages ctl={ctl} />
        </div>
        <div className="min-w-0">
          <CreditsCheckout ctl={ctl} />
        </div>
      </div>

      <CreditsFooter />
    </div>
  );
}

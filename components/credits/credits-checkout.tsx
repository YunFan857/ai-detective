'use client';

import { CreditCard, Lock, Smartphone } from 'lucide-react';
import { ComicButton } from '@/components/ui/comic-button';
import { formatYuan } from '@/lib/credits-format';
import type { CreditsCenterController } from '@/lib/use-credits-center';

export type CreditsCheckoutProps = {
  ctl: CreditsCenterController;
};

/** 右栏「确认订单」：套餐摘要、禁用的支付占位与模拟到账。 */
export function CreditsCheckout({ ctl }: CreditsCheckoutProps) {
  const { selected, account, busy } = ctl;
  const loading = account.status === 'loading';
  const after = loading ? null : account.balance + selected.points;

  return (
    <section aria-label="确认订单" className="comic-card flex flex-col p-4">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-brand-dark" aria-hidden />
        <h2 className="text-base font-black">确认订单</h2>
        <span className="ml-auto rounded-full border border-ink/25 bg-gray-soft px-2 py-0.5 text-[10px] font-black text-muted">
          演示
        </span>
      </div>

      <dl className="mt-3 divide-y divide-ink/10 rounded-xl border-2 border-ink/20 bg-paper px-3">
        <div className="flex items-start justify-between gap-3 py-2">
          <dt className="text-[11px] font-bold text-muted">档位</dt>
          <dd className="text-right text-[11px] font-black text-ink">
            {selected.name}
            <span className="ml-1 text-muted">· {selected.points} 积分</span>
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3 py-2">
          <dt className="text-[11px] font-bold text-muted">赠送</dt>
          <dd className="text-right text-[11px] font-black text-orange">
            {selected.bonusPoints > 0 ? `含赠送 ${selected.bonusPoints} 积分` : '无额外赠送'}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3 py-2">
          <dt className="text-[11px] font-bold text-muted">有效期</dt>
          <dd className="text-right text-[11px] font-black text-ink">永久有效（模拟充值）</dd>
        </div>
        <div className="flex items-start justify-between gap-3 py-2">
          <dt className="text-[11px] font-bold text-muted">到账后余额</dt>
          <dd className="text-right text-[11px] font-black text-brand-dark">
            {loading ? '读取中…' : `${after} 积分`}
          </dd>
        </div>
        <div className="flex items-end justify-between gap-3 py-2.5">
          <dt className="text-[11px] font-bold text-muted">应付</dt>
          <dd className="text-right text-2xl leading-none font-black text-ink">
            ¥{formatYuan(selected.priceYuan)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-gray bg-gray-soft px-2 py-2 text-xs font-black text-muted"
        >
          <Smartphone className="h-4 w-4" aria-hidden />
          微信支付
          <Lock className="h-3 w-3" aria-hidden />
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-gray bg-gray-soft px-2 py-2 text-xs font-black text-muted"
        >
          <Smartphone className="h-4 w-4" aria-hidden />
          支付宝
          <Lock className="h-3 w-3" aria-hidden />
        </button>
      </div>

      <p className="mt-2 rounded-lg border border-dashed border-ink/25 bg-card px-2.5 py-1.5 text-center text-[10px] leading-4 font-bold text-muted">
        支付即将开放 · 当前仅供演示
        <br />
        不会拉起真实支付，也不生成可扫码支付的二维码。
      </p>

      <div className="mt-3 rounded-xl border-2 border-ink bg-brand-soft p-2.5">
        <ComicButton
          variant="brand"
          className="w-full"
          onClick={(event) => {
            if (event.detail > 1) return;
            ctl.rechargeSelected();
          }}
          disabled={busy || loading}
        >
          {busy ? '模拟入账中…' : `模拟到账 ${selected.points} 积分`}
        </ComicButton>
        <p className="mt-1.5 text-center text-[10px] leading-4 font-bold text-muted">
          每次点击只模拟入账一次；不产生真实订单、付款或退款记录。
        </p>
      </div>

      <div className="mt-3 rounded-xl border-2 border-ink/20 bg-beige p-2.5">
        <p className="text-[11px] font-black text-ink">为什么是「演示」？</p>
        <p className="mt-1 text-[10px] leading-4 font-bold text-muted">
          项目目前没有积分账户、订单或支付接口。本页只维护当前浏览器的本地积分，
          用于演示签到、充值、查证扣费与退款闭环；刷新会保留，换浏览器或清缓存会重置。
        </p>
      </div>
    </section>
  );
}

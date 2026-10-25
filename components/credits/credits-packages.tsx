'use client';

import Link from 'next/link';
import { FileText, FlaskConical, SearchCheck } from 'lucide-react';
import { ComicButton } from '@/components/ui/comic-button';
import { CreditsLedger } from '@/components/credits/credits-ledger';
import { formatYuan } from '@/lib/credits-format';
import { CREDITS_PER_CLAIM, REFUND_PER_CLAIM } from '@/lib/credits-policy';
import type { CreditsCenterController } from '@/lib/use-credits-center';

export type CreditsPackagesProps = {
  ctl: CreditsCenterController;
};

/** 中栏「购买积分」：三档套餐、退款说明、真实样例与最近流水。 */
export function CreditsPackages({ ctl }: CreditsPackagesProps) {
  const { account, busy } = ctl;

  return (
    <section aria-label="购买积分" className="comic-card flex flex-col p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="flex items-center gap-1.5 text-base font-black">
          <span aria-hidden>🛒</span>
          选择充值档位
        </h2>
        <p className="ml-auto text-[10px] font-bold text-muted">演示价：约 0.1 元 / 积分</p>
      </div>

      <div
        role="radiogroup"
        aria-label="充值档位"
        className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3"
      >
        {ctl.packages.map((item) => {
          const checked = ctl.selectedId === item.id;
          const claimCount = Math.floor(item.points / CREDITS_PER_CLAIM);

          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => ctl.selectPackage(item.id)}
              className={`relative flex flex-col rounded-2xl border-[3px] px-3 pt-4 pb-3 text-left transition-[transform,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark ${
                checked
                  ? '-translate-y-0.5 border-ink bg-brand-soft shadow-brand-sm'
                  : 'border-ink bg-card shadow-ink-sm hover:-translate-y-0.5'
              }`}
            >
              {item.popular ? (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rotate-2 rounded border-2 border-ink bg-coral px-2 py-0.5 text-[9px] font-black whitespace-nowrap text-white shadow-ink-sm">
                  最受欢迎
                </span>
              ) : null}

              <span className="block text-[11px] font-black text-muted">{item.name}</span>
              <span className="mt-1 flex items-end gap-1 text-ink">
                <span className="text-[38px] leading-none font-black tabular-nums">
                  {item.points}
                </span>
                <span className="mb-1 text-[11px] font-bold text-muted">积分</span>
              </span>
              <span className="mt-1 block text-2xl leading-none font-black text-brand-dark">
                ¥{formatYuan(item.priceYuan)}
              </span>
              <span className="mt-1.5 block text-[10px] leading-4 font-bold text-muted">
                约可查 {claimCount} 个疑点
              </span>

              <span className="mt-2 flex flex-wrap items-center gap-1">
                {item.tag ? (
                  <span className="rounded-full border border-ink bg-tangerine px-1.5 py-px text-[9px] font-black text-white">
                    {item.tag}
                  </span>
                ) : null}
                {item.bonusPoints > 0 ? (
                  <span className="rounded-full border border-ink/25 bg-card px-1.5 py-px text-[9px] font-black text-muted">
                    含赠送 {item.bonusPoints}
                  </span>
                ) : null}
              </span>

              <span
                className={`mt-2 inline-flex items-center gap-1 self-start rounded-full border-2 border-ink px-2.5 py-0.5 text-[10px] font-black ${
                  checked ? 'bg-brand text-white' : 'bg-card text-ink'
                }`}
              >
                {checked ? '已选中 ✓' : '选择这档'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-xl border-2 border-dashed border-ink/30 bg-brand-soft p-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-black text-ink">
          <SearchCheck className="h-3.5 w-3.5 text-brand-dark" aria-hidden />
          积分怎么用
        </p>
        <ul className="mt-1 space-y-1 text-[10px] leading-4 font-bold text-muted">
          <li>· 每个疑点 {CREDITS_PER_CLAIM} 积分；查证结论会给出可点开的出处。</li>
          <li>· 符合退款条件时，每个疑点退回 {REFUND_PER_CLAIM} 积分；整案失败按结算结果退款。</li>
          <li>· 免费拆疑点不扣积分；0 个疑点或未勾选疑点不发起扣费。</li>
          <li>· 演示积分只写入当前浏览器，不产生真实订单、支付回调或可扫码二维码。</li>
        </ul>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink/20 bg-card px-2.5 py-2">
        <FileText className="h-4 w-4 shrink-0 text-blue" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black text-ink">样例报告：四渡赤水文案体检</p>
          <p className="text-[10px] font-bold text-muted">
            已在 cache/ 中的真实演示卷宗，可直接打开看完整出处。
          </p>
        </div>
        <Link
          href="/case?mode=demo&demoId=script-demo-1"
          className="shrink-0 rounded-full border-2 border-ink bg-brand px-2.5 py-1 text-[10px] font-black text-white shadow-ink-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
        >
          查看样例
        </Link>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink/20 bg-beige px-2.5 py-2">
        <FlaskConical className="h-4 w-4 shrink-0 text-tangerine" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black text-ink">演示：模拟充值 +100</p>
          <p className="text-[10px] font-bold text-muted">只入账本地积分，不发生真实付款。</p>
        </div>
        <ComicButton
          variant="white"
          size="sm"
          onClick={(event) => {
            // 双击的第二次点击 detail=2，直接忽略；独立点击 detail=1 仍可正常入账。
            if (event.detail > 1) return;
            ctl.simulatePlus100();
          }}
          disabled={busy}
        >
          {busy ? '入账中…' : '模拟 +100'}
        </ComicButton>
      </div>

      <CreditsLedger entries={account.entries} asOf={account.asOf} />
    </section>
  );
}

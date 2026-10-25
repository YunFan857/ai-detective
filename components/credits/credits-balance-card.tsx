'use client';

import { Gift, Sparkles, Wallet } from 'lucide-react';
import { ComicButton } from '@/components/ui/comic-button';
import { formatShanghaiDay, shanghaiDateKey } from '@/lib/credits-format';
import {
  CHECKIN_POINTS,
  CREDITS_PER_CLAIM,
  GIFT_VALID_DAYS,
  INITIAL_GIFT_POINTS,
  REFUND_PER_CLAIM,
} from '@/lib/credits-policy';
import type { CreditsSnapshot } from '@/lib/credits-store';

export type CreditsBalanceCardProps = {
  account: CreditsSnapshot;
  onCheckIn: () => void;
};

/** 左栏「我的积分」：总余额、赠送批次、签到与演示规则。 */
export function CreditsBalanceCard({ account, onCheckIn }: CreditsBalanceCardProps) {
  const loading = account.status === 'loading';
  const claimCount = Math.floor(account.balance / CREDITS_PER_CLAIM);
  const today = account.asOf > 0 ? shanghaiDateKey(account.asOf) : '—';

  return (
    <section aria-label="我的积分" className="comic-card flex flex-col p-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-brand-dark" aria-hidden />
        <h2 className="text-base font-black">我的积分</h2>
        <span className="ml-auto rounded-full border border-ink/25 bg-gray-soft px-2 py-0.5 text-[10px] font-black text-muted">
          本地演示
        </span>
      </div>

      <div className="mt-3 rounded-2xl border-2 border-ink bg-beige px-3 py-3 shadow-ink-sm">
        <div className="flex items-end gap-1.5">
          <span className="text-[52px] leading-none font-black tabular-nums text-ink">
            {loading ? '—' : account.balance}
          </span>
          <span className="mb-1 text-xs font-bold text-muted">积分</span>
        </div>
        <p className="mt-1 text-[11px] font-bold text-muted">
          {loading
            ? '正在读取本地积分…'
            : `约可查 ${claimCount} 个疑点 · 每个疑点 ${CREDITS_PER_CLAIM} 积分`}
        </p>

        {account.issue ? (
          <p
            role="alert"
            className="mt-2 rounded-lg border-2 border-coral bg-coral-soft px-2 py-1.5 text-[10px] leading-4 font-bold text-coral"
          >
            {account.issue === 'corrupt'
              ? '本地积分数据已损坏，已恢复为演示初始状态；旧数据已尝试备份。'
              : '浏览器存储不可用，积分只在当前页面有效，刷新后会重置。'}
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border-2 border-ink bg-card px-2.5 py-2">
          <p className="flex items-center gap-1 text-[10px] font-black text-muted">
            <Gift className="h-3 w-3 text-orange" aria-hidden />
            赠送积分
          </p>
          <p className="mt-0.5 text-xl leading-none font-black tabular-nums text-orange">
            {loading ? '—' : account.giftBalance}
          </p>
        </div>
        <div className="rounded-xl border-2 border-ink bg-card px-2.5 py-2">
          <p className="flex items-center gap-1 text-[10px] font-black text-muted">
            <Wallet className="h-3 w-3 text-brand-dark" aria-hidden />
            模拟充值积分
          </p>
          <p className="mt-0.5 text-xl leading-none font-black tabular-nums text-brand-dark">
            {loading ? '—' : account.rechargeBalance}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border-2 border-ink/20 bg-paper p-2.5">
        <p className="text-[11px] font-black text-ink">赠送批次</p>
        {loading ? (
          <p className="mt-1 text-[10px] text-muted">读取中…</p>
        ) : account.giftLots.length === 0 ? (
          <p className="mt-1 text-[10px] font-bold text-muted">暂无可用赠送积分。</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {account.giftLots.map((lot) => (
              <li
                key={lot.id}
                className="flex items-start gap-2 rounded-lg border border-ink/15 bg-card px-2 py-1.5"
              >
                <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] leading-4 font-black text-ink">{lot.label}</p>
                  <p className="text-[10px] leading-4 font-bold text-muted">
                    剩余 {lot.remaining} 积分
                    {lot.expiresAt
                      ? ` · ${formatShanghaiDay(lot.expiresAt, account.asOf || lot.expiresAt)} 23:59 到期`
                      : ' · 长期有效'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] leading-4 font-bold text-muted">
          扣费顺序：先用最快过期的赠送积分，再用模拟充值积分。
        </p>
      </div>

      <div className="mt-3 rounded-xl border-2 border-ink bg-brand-soft p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black text-ink">每日签到 +{CHECKIN_POINTS} 积分</p>
            <p className="mt-0.5 text-[10px] leading-4 font-bold text-muted">
              同一浏览器同一北京时间日期只能领取一次
              {account.lastCheckInDate ? ` · 上次 ${account.lastCheckInDate}` : ''}
            </p>
          </div>
          <ComicButton
            variant={account.checkedInToday ? 'white' : 'orange'}
            size="sm"
            onClick={onCheckIn}
            disabled={loading || account.checkedInToday}
          >
            {account.checkedInToday ? '今日已领取 ✓' : `签到 +${CHECKIN_POINTS}`}
          </ComicButton>
        </div>
        <p className="mt-1.5 text-[10px] leading-4 font-bold text-brand-dark">
          北京时间 {today} · 签到积分同为赠送积分，{GIFT_VALID_DAYS} 天内有效。
        </p>
      </div>

      <div className="mt-3 rounded-xl border-2 border-dashed border-ink/25 bg-card p-2.5">
        <p className="flex items-center gap-1 text-[11px] font-black text-ink">
          <Sparkles className="h-3.5 w-3.5 text-brand" aria-hidden />
          演示规则
        </p>
        <ul className="mt-1.5 space-y-1 text-[10px] leading-4 font-bold text-muted">
          <li>· 新用户演示赠送 {INITIAL_GIFT_POINTS} 积分，只初始化一次。</li>
          <li>
            · 查证 1 个疑点 {CREDITS_PER_CLAIM} 积分；符合退款条件退 {REFUND_PER_CLAIM} 积分。
          </li>
          <li>· 赠送积分有效期 {GIFT_VALID_DAYS} 个自然日（Asia/Shanghai 解释，演示规则）。</li>
          <li>· 免费拆疑点不扣积分；没有可查疑点不扣积分。</li>
          <li>· 积分仅保存在当前浏览器，不支持真实支付。</li>
        </ul>
      </div>
    </section>
  );
}

import { Receipt } from 'lucide-react';
import { formatShanghaiDateTime } from '@/lib/credits-format';
import { creditEntryLabel } from '@/lib/labels';
import type { CreditEntry } from '@/lib/credits-store';

export type CreditsLedgerProps = {
  entries: CreditEntry[];
  /** 快照时间，用于按北京时间展示日期，避免渲染中调用 Date.now()。 */
  asOf: number;
  limit?: number;
};

/** 最近积分流水：入账为正，扣减 / 到期为负。 */
export function CreditsLedger({ entries, asOf, limit = 8 }: CreditsLedgerProps) {
  const recent = entries.slice(0, limit);

  return (
    <section
      aria-label="最近积分流水"
      className="mt-3 rounded-xl border-2 border-ink/20 bg-paper p-2.5"
    >
      <div className="flex items-center gap-1.5">
        <Receipt className="h-3.5 w-3.5 text-brand-dark" aria-hidden />
        <h3 className="text-[11px] font-black text-ink">最近积分流水</h3>
        <span className="ml-auto text-[10px] font-bold text-muted">
          {entries.length > 0 ? `共 ${entries.length} 条` : '暂无记录'}
        </span>
      </div>

      {recent.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-ink/25 bg-card px-2 py-3 text-center text-[10px] font-bold text-muted">
          还没有积分流水。签到、模拟充值或查证后会出现在这里。
        </p>
      ) : (
        <ul className="mt-1.5 divide-y divide-ink/10">
          {recent.map((entry) => {
            const positive = entry.amount > 0;
            const muted = entry.type === 'expire';
            return (
              <li key={entry.id} className="flex items-start gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-4 font-black text-ink">
                    {creditEntryLabel(entry.type)}
                    <span className="ml-1.5 font-bold text-muted">
                      {formatShanghaiDateTime(entry.at, asOf || entry.at)}
                    </span>
                  </p>
                  <p
                    className="truncate text-[10px] leading-4 font-bold text-muted"
                    title={entry.note}
                  >
                    {entry.note}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-black tabular-nums ${
                    muted ? 'text-muted' : positive ? 'text-brand-dark' : 'text-coral'
                  }`}
                >
                  {positive ? '+' : ''}
                  {entry.amount}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {entries.length > recent.length ? (
        <p className="mt-1 text-right text-[10px] font-bold text-muted">
          仅展示最近 {recent.length} 条
        </p>
      ) : null}
    </section>
  );
}

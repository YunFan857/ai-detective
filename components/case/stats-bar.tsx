import type { Stats } from '@/types/case';

export type StatsBarProps = {
  stats: Stats | null;
};

const ITEMS = [
  { key: 'apiCalls', label: '开庭检索', unit: '次' },
  { key: 'sourcesVisited', label: '走访来源', unit: '' },
  { key: 'independentWitnesses', label: '独立证人', unit: '位' },
  { key: 'durationMs', label: '用时', unit: 's' },
] as const;

/** 顶部栏统计：开庭检索、走访来源、独立证人、用时。 */
export function StatsBar({ stats }: StatsBarProps) {
  return (
    <div className="flex shrink-0 items-stretch gap-1.5" aria-label="办案统计">
      {ITEMS.map((item) => {
        const raw =
          item.key === 'durationMs'
            ? Math.round((stats?.durationMs ?? 0) / 1000)
            : (stats?.[item.key] ?? 0);

        return (
          <div
            key={item.key}
            className="min-w-[70px] rounded-lg border-2 border-ink bg-card px-2 py-1 text-center leading-none shadow-ink-sm"
          >
            <p className="text-[10px] font-bold whitespace-nowrap text-muted">{item.label}</p>
            <p className="mt-1 text-sm font-black whitespace-nowrap text-ink">
              {raw}
              {item.unit ? <span className="text-[10px]">{item.unit}</span> : null}
            </p>
          </div>
        );
      })}
    </div>
  );
}

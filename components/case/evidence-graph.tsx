import type { Claim, Source, SourceGroup } from '@/types/case';
import { STEPS, stepById, type StepId } from '@/lib/steps';

export type EvidenceGraphProps = {
  claims: Claim[];
  sourcesById: Record<string, Source>;
  sourceOrder: string[];
  groups: SourceGroup[];
  activeStep: StepId;
  closed: boolean;
};

const LEGEND = [
  { id: 1, hint: '待核验的断言' },
  { id: 2, hint: '权威信源' },
  { id: 3, hint: '转载扩散' },
  { id: 4, hint: '拼接放大' },
] as const;

/**
 * 右侧「图谱画布」。
 * 当前先放占位画布与图例，节点绘制和连线后续实现。
 */
export function EvidenceGraph({
  claims,
  sourcesById,
  sourceOrder,
  groups,
  activeStep,
  closed,
}: EvidenceGraphProps) {
  const step = stepById(activeStep);
  const tieredSources = sourceOrder.filter((id) => sourcesById[id]?.tier).length;

  return (
    <section
      aria-label="证据图谱画布"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] border-[3px] border-ink bg-card shadow-ink"
    >
      <div className="paper-dots relative min-h-0 flex-1">
        <span className="absolute top-3 right-3 rounded-lg border-2 border-ink bg-card px-2 py-1 text-[11px] font-bold text-muted shadow-ink-sm">
          新节点只追加 · 已有节点不改
        </span>

        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="flex w-full max-w-[460px] flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ink/25 bg-card/75 px-6 py-8 text-center">
            <p className="text-sm font-black text-ink">图谱画布 · EvidenceGraph</p>
            <p className="text-xs text-muted">
              {claims.length} 个疑点 · {tieredSources}/{sourceOrder.length} 条已分级来源 ·{' '}
              {groups.length} 个同源组
            </p>
            <p className="text-xs font-black" style={{ color: step.color }}>
              当前第 {activeStep} 步 · {step.name}
            </p>
            {closed ? <p className="text-[11px] font-bold text-muted">已结案，等待判决书</p> : null}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t-2 border-ink px-4 py-2 text-[11px] font-bold">
        {LEGEND.map((item) => {
          const legendStep = STEPS[item.id - 1];

          return (
            <span key={item.id} className="flex items-center gap-1.5">
              <i
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: legendStep.color }}
                aria-hidden
              />
              <span style={{ color: legendStep.color }}>{legendStep.name}</span>
              <span className="font-normal text-muted">· {item.hint}</span>
            </span>
          );
        })}
      </footer>
    </section>
  );
}

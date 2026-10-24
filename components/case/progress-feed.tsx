import type { BroadcastLog, InvestigationState } from '@/lib/use-investigation';
import { LinkIcon, MicIcon } from '@/components/ui/icons';
import { STEPS, type StepId } from '@/lib/steps';

export type ProgressFeedProps = {
  /** 「案件来源 · xxx」里的来源文案。 */
  sourceLabel: string;
  logs: BroadcastLog[];
  activeStep: StepId;
  status: InvestigationState['status'];
};

const STEP_INDEX = ['①', '②', '③', '④'] as const;

/**
 * 左栏「办案实况」。
 * 当前只搭出分组骨架，阶段播报的逐条渲染后续补齐。
 */
export function ProgressFeed({ sourceLabel, logs, activeStep, status }: ProgressFeedProps) {
  return (
    <aside
      aria-label={`办案实况，已记录 ${logs.length} 条播报`}
      className="comic-card flex w-[300px] shrink-0 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-ink/15 px-3 py-2.5">
        <MicIcon className="h-4 w-4" />
        <h2 className="text-sm font-black">办案实况</h2>
      </div>

      <div className="mx-3 mt-2 flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-ink/20 bg-paper px-2.5 py-1.5 text-[11px] text-muted">
        <LinkIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">案件来源</span>
        <span aria-hidden>·</span>
        <span className="truncate font-bold text-ink">{sourceLabel}</span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {STEPS.map((step) => {
          const reached = step.id <= activeStep;
          const running = status === 'running' && step.id === activeStep;

          return (
            <section key={step.id} aria-label={`第 ${step.id} 步 ${step.name}`}>
              <div className="flex items-center gap-2">
                <i
                  className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-ink"
                  style={{ backgroundColor: reached ? step.color : 'var(--color-gray-soft)' }}
                  aria-hidden
                />
                <h3 className={`text-sm ${reached ? 'font-black text-ink' : 'font-bold text-muted'}`}>
                  {STEP_INDEX[step.id - 1]} {step.name}
                </h3>
                {running ? (
                  <span className="ml-auto text-[10px] font-bold whitespace-nowrap text-muted">
                    进行中…
                  </span>
                ) : null}
              </div>

              {reached ? (
                <div
                  className="mt-2 ml-1.5 space-y-2 border-l-2 py-1 pl-3"
                  style={{ borderColor: step.soft }}
                  aria-hidden
                >
                  <div className="h-3 w-[88%] rounded bg-gray-soft" />
                  <div className="h-3 w-[64%] rounded bg-gray-soft" />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

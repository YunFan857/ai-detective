import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { LinkIcon } from '@/components/ui/icons';
import { StatsBar } from '@/components/stats-bar';
import { stepById, type StepId } from '@/lib/steps';
import type { InvestigationState } from '@/lib/use-investigation';

export type CaseHeaderProps = {
  caseId: string | null;
  input: string;
  modeLabel: string;
  state: InvestigationState;
  activeStep: StepId;
  closed: boolean;
};

/** 卷宗页顶部绿栏：卷宗号、立案方式、原始消息、统计与当前步骤。 */
export function CaseHeader({
  caseId,
  input,
  modeLabel,
  state,
  activeStep,
  closed,
}: CaseHeaderProps) {
  const step = stepById(activeStep);

  return (
    <header className="flex h-[64px] shrink-0 items-center gap-3 border-b-[3px] border-ink bg-brand px-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-ink bg-brand-soft">
        <DetectiveMascot variant="avatar" className="h-11 w-11 -translate-y-1" />
      </span>

      <h1 className="shrink-0 text-xl font-black whitespace-nowrap text-white [text-shadow:2px_2px_0_var(--color-ink)]">
        卷宗 <span className="tracking-wider">#{caseId ?? '------'}</span>
      </h1>

      <span className="flex shrink-0 items-center gap-1 rounded-full border-2 border-ink bg-card px-2.5 py-1 text-xs font-black whitespace-nowrap text-ink shadow-ink-sm">
        <LinkIcon className="h-3.5 w-3.5" />
        {modeLabel}
      </span>

      <p
        title={input || undefined}
        className="min-w-0 flex-1 truncate text-sm font-bold text-beige [text-shadow:1px_1px_0_rgb(31_35_41_/_0.45)]"
      >
        {input || '等待原始消息…'}
      </p>

      <StatsBar state={state} />

      <span
        aria-live="polite"
        className={`flex shrink-0 items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1.5 text-sm font-black whitespace-nowrap text-ink shadow-ink-sm ${
          closed ? 'bg-beige' : 'bg-card'
        }`}
      >
        {closed ? (
          <>
            <span aria-hidden>📜</span>
            已结案
          </>
        ) : (
          <>
            <i
              className="h-2.5 w-2.5 rounded-full border border-ink"
              style={{ backgroundColor: step.color }}
              aria-hidden
            />
            第 {activeStep} 步 · {step.name}
          </>
        )}
      </span>
    </header>
  );
}

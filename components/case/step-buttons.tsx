import { clsx } from 'clsx';
import { STEPS, type StepId } from '@/lib/steps';

export type StepButtonsProps = {
  activeStep: StepId;
  closed: boolean;
  /** 判决结果已产出、还在整理判决书时，结案格显示进行中。 */
  verdictReady: boolean;
};

const STEP_INDEX = ['①', '②', '③', '④'] as const;

/** 底部五格步骤条：起点 / 官方 / 媒体 / 自媒体 / 结案。 */
export function StepButtons({ activeStep, closed, verdictReady }: StepButtonsProps) {
  return (
    <nav className="grid grid-cols-5 gap-3" aria-label="办案步骤">
      {STEPS.map((step) => {
        const isActive = step.id === activeStep && !closed;
        const isPast = closed || step.id < activeStep;
        const label = `${STEP_INDEX[step.id - 1]} ${step.name}`;

        return (
          <button
            key={step.id}
            type="button"
            aria-current={isActive ? 'step' : undefined}
            className={clsx(
              'flex h-[68px] items-center justify-center gap-2 rounded-xl border-[3px] text-base font-black transition-transform',
              !isActive && !isPast && 'border-dashed border-ink/30 bg-card/60 text-muted',
              isActive && 'border-ink text-white shadow-ink-sm',
              isPast && 'border-solid bg-card',
            )}
            style={
              isActive
                ? { backgroundColor: step.color, color: 'var(--color-white)' }
                : isPast
                  ? { borderColor: step.color, color: step.color }
                  : undefined
            }
          >
            {label}
          </button>
        );
      })}

      <button
        type="button"
        aria-current={closed ? 'step' : undefined}
        className={clsx(
          'flex h-[68px] items-center justify-center gap-2 rounded-xl border-[3px] text-base font-black transition-transform',
          closed
            ? 'border-ink bg-ink text-beige shadow-[4px_4px_0_var(--color-brand)]'
            : verdictReady
              ? 'border-dashed border-ink/40 bg-beige text-ink'
              : 'border-dashed border-ink/30 bg-card/60 text-muted',
        )}
      >
        <span aria-hidden>📜</span>
        {closed ? '结案！' : verdictReady ? '整理判决书…' : '结案'}
      </button>
    </nav>
  );
}

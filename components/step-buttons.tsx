import { clsx } from 'clsx';
import type { StepIndex, StepRevealResult } from '@/lib/use-step-reveal';

type VisibleStep = Exclude<StepIndex, 0>;

type StepMeta = {
  label: string;
  /** 当前查看时的实心底色 */
  solid: string;
  /** 已揭示但未查看时的描边色 */
  border: string;
  /** 已揭示但未查看时的文字色 */
  text: string;
};

const STEP_META: Record<VisibleStep, StepMeta> = {
  1: { label: '起点', solid: 'bg-ink', border: 'border-ink', text: 'text-ink' },
  2: { label: '官方', solid: 'bg-brand', border: 'border-brand', text: 'text-brand-dark' },
  3: { label: '媒体', solid: 'bg-blue', border: 'border-blue', text: 'text-blue' },
  4: { label: '自媒体', solid: 'bg-orange', border: 'border-orange', text: 'text-orange' },
  5: { label: '结案', solid: 'bg-ink', border: 'border-ink', text: 'text-ink' },
};

const STEP_ORDER: VisibleStep[] = [1, 2, 3, 4, 5];

const NUMBER_LABELS: Record<VisibleStep, string> = {
  1: '①',
  2: '②',
  3: '③',
  4: '④',
  5: '结案',
};

const BASE_CLASS =
  'relative flex h-[60px] min-w-0 items-center justify-center gap-1.5 rounded-xl px-1.5 text-sm font-black tracking-wide whitespace-nowrap transition-[transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark';

/** 进行中格子的文案：第 1 步拆疑点、第 5 步写判决，中间三步都是走访。 */
function runningLabel(step: VisibleStep): string {
  if (step === 1) return '⏳ 拆解疑点…';
  if (step === 5) return '⏳ 整理判决书…';
  return `⏳ ${STEP_META[step].label} · 走访中…`;
}

export type StepButtonsProps = {
  /** useStepReveal 的返回值。 */
  reveal: StepRevealResult;
  /** 点击已揭示的结案按钮时打开判决书卡片。 */
  onOpenVerdict?: () => void;
  className?: string;
};

/**
 * 底部五格步骤条：未到 / 进行中 / 已揭示（当前或历史）/ 结案。
 * 已揭示的历史步骤可点击回看；manual 模式下下一步显示为「▶ 下一步」。
 */
export function StepButtons({ reveal, onOpenVerdict, className }: StepButtonsProps) {
  return (
    <nav aria-label="办案步骤" className={clsx('grid grid-cols-5 gap-2 sm:gap-3', className)}>
      {STEP_ORDER.map((step) => {
        const meta = STEP_META[step];
        const revealed = reveal.revealedStep >= step;
        const isCurrent = reveal.viewStep === step;

        if (revealed && step === 5) {
          return (
            <button
              key={step}
              type="button"
              aria-label="打开判决书"
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => {
                reveal.setViewStep(step);
                onOpenVerdict?.();
              }}
              className={clsx(
                BASE_CLASS,
                'border-[3px] border-ink bg-ink text-white shadow-brand',
                isCurrent ? '-translate-y-1' : 'hover:-translate-y-0.5',
              )}
            >
              <span aria-hidden>📜</span>
              结案！
            </button>
          );
        }

        if (revealed) {
          return (
            <button
              key={step}
              type="button"
              aria-label={`查看第 ${step} 步：${meta.label}`}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => reveal.setViewStep(step)}
              className={clsx(
                BASE_CLASS,
                'border-[3px]',
                meta.border,
                isCurrent
                  ? clsx(meta.solid, '-translate-y-1 text-white shadow-ink')
                  : clsx('bg-card', meta.text, 'hover:-translate-y-0.5'),
              )}
            >
              <span aria-hidden>{NUMBER_LABELS[step]}</span>
              <span>{meta.label}</span>
            </button>
          );
        }

        // manual 路演：下一步由路演者点击推进，不自动往前走。
        if (reveal.pace === 'manual' && step === reveal.revealedStep + 1) {
          return (
            <button
              key={step}
              type="button"
              aria-label={`下一步：${meta.label}`}
              onClick={() => reveal.setViewStep(step)}
              className={clsx(
                BASE_CLASS,
                'border-[3px] border-dashed border-ink bg-card text-ink shadow-ink-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none',
              )}
            >
              ▶ 下一步
            </button>
          );
        }

        if (reveal.isRunning(step)) {
          return (
            <div
              key={step}
              aria-label={`第 ${step} 步：${meta.label}，进行中`}
              className={clsx(
                BASE_CLASS,
                'hatch cursor-default border-[3px] border-dashed border-muted bg-card text-muted',
              )}
            >
              {runningLabel(step)}
            </div>
          );
        }

        return (
          <button
            key={step}
            type="button"
            disabled
            aria-label={`第 ${step} 步：${meta.label}（未到）`}
            className={clsx(
              BASE_CLASS,
              'cursor-not-allowed border-[3px] border-dashed border-muted/60 bg-card/50 text-muted/70',
            )}
          >
            {NUMBER_LABELS[step]}
          </button>
        );
      })}
    </nav>
  );
}

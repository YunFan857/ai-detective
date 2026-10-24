'use client';

import { clsx } from 'clsx';
import { Fragment, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { stepById, stepOfTier, type StepId } from '@/lib/steps';
import type { Source, Tier, TimelineStep } from '@/types/case';

export type MutationTimelineProps = {
  steps: TimelineStep[];
  sourcesById: Record<string, Source>;
  variant: 'mini' | 'full';
  /**
   * 点击任意一格时回调。
   * 父级据此收起判决书卡片、把画布切到该来源所在步骤，并让对应节点闪烁居中。
   */
  onSelectSource?: (sourceId: string, stepId: StepId) => void;
};

/** 设计稿最多四格：超出时保留起点、中途两个代表格和终点。 */
const MAX_PANELS = 4;

type TimelinePanel = {
  step: TimelineStep;
  site: string;
  tier: Tier;
  stepId: StepId;
  /** 该来源所在步骤的描边色。 */
  color: string;
  /** 该来源所在步骤的浅底色。 */
  soft: string;
  /** 上一格的 quote，用于算出这一格被改动的位置。 */
  previousQuote?: string;
};

type PanelSelect = (sourceId: string, stepId: StepId) => void;

function yearLabel(publishedAt?: string): string {
  return publishedAt ? publishedAt.slice(0, 4) : '年份未知';
}

function dateLabel(publishedAt?: string): string {
  return publishedAt ? publishedAt.slice(0, 10) : '日期未知';
}

function pickPanels(steps: TimelineStep[]): TimelineStep[] {
  if (steps.length <= MAX_PANELS) return steps;

  const last = steps.length - 1;
  return [0, Math.round(last / 3), Math.round((last * 2) / 3), last].map((index) => steps[index]);
}

function buildPanels(steps: TimelineStep[], sourcesById: Record<string, Source>): TimelinePanel[] {
  return steps.map((step, index) => {
    const source = sourcesById[step.sourceId];
    const tier = source?.tier ?? 'unknown';
    const stepId = stepOfTier(tier);
    const palette = stepById(stepId);

    return {
      step,
      site: source?.site ?? '出处待补充',
      tier,
      stepId,
      color: palette.color,
      soft: palette.soft,
      previousQuote: steps[index - 1]?.quote,
    };
  });
}

type QuoteSegment = { text: string; changed: boolean };

/**
 * 字符级差异：把这一格 quote 里相对上一格新增 / 改写的部分标出来。
 * 只渲染当前 quote，不显示被删掉的字。
 */
function diffQuote(previous: string | undefined, current: string): QuoteSegment[] {
  if (!previous || previous === current) {
    return [{ text: current, changed: false }];
  }

  const before = Array.from(previous);
  const after = Array.from(current);
  const rows = before.length;
  const cols = after.length;

  // lcs[i][j]：before[i:] 与 after[j:] 的最长公共子序列长度。
  const lcs: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const segments: QuoteSegment[] = [];
  const push = (text: string, changed: boolean) => {
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) {
      last.text += text;
      return;
    }
    segments.push({ text, changed });
  };

  let i = 0;
  let j = 0;

  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      push(after[j], false);
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i += 1;
    } else {
      push(after[j], true);
      j += 1;
    }
  }

  while (j < cols) {
    push(after[j], true);
    j += 1;
  }

  return segments;
}

/** 大字 quote：变化的关键词用荧光笔底色标出。 */
function HighlightedQuote({ quote, previous }: { quote: string; previous?: string }) {
  const segments = useMemo(() => diffQuote(previous, quote), [previous, quote]);

  return (
    <span className="block break-words">
      {segments.map((segment, index) =>
        segment.changed ? (
          <mark
            key={index}
            className="box-decoration-clone rounded-[3px] bg-brand-soft px-0.5 text-ink"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

/** 无时间线时的占位：mini 一行，full 一块。 */
function EmptyTimeline({ variant }: { variant: MutationTimelineProps['variant'] }) {
  return (
    <p
      className={clsx(
        'text-center font-bold text-muted',
        variant === 'mini'
          ? 'rounded-lg border-2 border-dashed border-ink/20 bg-card/70 px-3 py-2 text-[11px]'
          : 'rounded-xl border-2 border-dashed border-ink/25 bg-card/60 px-4 py-8 text-sm',
      )}
    >
      该疑点未发现明显的传播变形链
    </p>
  );
}

/** mini：判决书卡片内的横排四格小卡。 */
function MiniTimeline({ panels, onSelect }: { panels: TimelinePanel[]; onSelect: PanelSelect }) {
  return (
    <div className="flex items-stretch gap-1">
      {panels.map((panel, index) => (
        <Fragment key={`${panel.step.sourceId}-${index}`}>
          {index > 0 ? (
            <span
              aria-hidden
              className="flex w-2.5 shrink-0 items-center justify-center text-[9px] leading-none text-ink/40"
            >
              ▶
            </span>
          ) : null}

          <button
            type="button"
            aria-label={`查看 ${panel.site} 在 ${yearLabel(panel.step.publishedAt)} 的说法：${panel.step.quote}`}
            onClick={() => onSelect(panel.step.sourceId, panel.stepId)}
            className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border-2 p-1.5 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
            style={{ borderColor: panel.color, backgroundColor: panel.soft }}
          >
            <span
              className="flex min-w-0 items-baseline gap-1 text-[11px] font-black"
              style={{ color: panel.color }}
            >
              <span className="shrink-0">{yearLabel(panel.step.publishedAt)}</span>
              <span aria-hidden className="shrink-0 text-ink/30">
                ·
              </span>
              <span className="truncate">{panel.site}</span>
            </span>
            <span className="line-clamp-2 text-[11px] leading-4 text-ink/75">
              {panel.step.quote}
            </span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/** 格间红色胶囊：写这一步相对上一步的变形文案。 */
function MutationCapsule({ text }: { text?: string }) {
  if (!text) {
    return (
      <span
        aria-hidden
        className="flex w-5 shrink-0 items-center justify-center text-xs font-black text-ink/40"
      >
        ▶
      </span>
    );
  }

  return (
    <span className="flex w-[104px] shrink-0 items-center justify-center">
      <span className="-rotate-2 rounded-full border-2 border-ink bg-red px-2 py-1.5 text-center text-[10px] font-black leading-[1.35] break-words text-white shadow-ink-sm">
        {text}
      </span>
    </span>
  );
}

/** full：结案卷宗页 / 辟谣卡片的四格漫画。 */
function FullTimeline({ panels, onSelect }: { panels: TimelinePanel[]; onSelect: PanelSelect }) {
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
      {panels.map((panel, index) => {
        const isLast = index === panels.length - 1 && panels.length > 1;

        return (
          <Fragment key={`${panel.step.sourceId}-${index}`}>
            {index > 0 ? <MutationCapsule text={panel.step.mutation} /> : null}

            <button
              type="button"
              aria-label={`查看 ${panel.site} 在 ${dateLabel(panel.step.publishedAt)} 的说法：${panel.step.quote}`}
              onClick={() => onSelect(panel.step.sourceId, panel.stepId)}
              className={clsx(
                'flex min-w-[150px] flex-1 flex-col gap-2 rounded-xl border-[3px] p-3 text-left shadow-ink-sm transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark',
                isLast ? 'bg-red-soft' : 'bg-card',
              )}
              style={{ borderColor: panel.color }}
            >
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-black text-ink">
                <span>{dateLabel(panel.step.publishedAt)}</span>
                <span aria-hidden className="text-muted">
                  ·
                </span>
                <span className="max-w-full truncate">{panel.site}</span>
              </span>

              <Badge tier={panel.tier} className="self-start" />

              <span className="block text-base leading-6 font-black text-ink">
                <HighlightedQuote
                  quote={panel.step.quote}
                  previous={index > 0 ? panel.previousQuote : undefined}
                />
              </span>

              {isLast ? (
                <span className="huazi huazi-red mt-auto -rotate-3 self-end text-2xl" aria-hidden>
                  离谱!!
                </span>
              ) : null}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * 传播变形时间线。
 * mini 放在判决书卡片里；full 用于结案卷宗页与辟谣卡片。
 */
export function MutationTimeline({
  steps,
  sourcesById,
  variant,
  onSelectSource,
}: MutationTimelineProps) {
  const visibleSteps = useMemo(() => pickPanels(steps), [steps]);
  const panels = useMemo(() => buildPanels(visibleSteps, sourcesById), [visibleSteps, sourcesById]);

  if (panels.length === 0) {
    return <EmptyTimeline variant={variant} />;
  }

  const handleSelect: PanelSelect = (sourceId, stepId) => {
    onSelectSource?.(sourceId, stepId);
  };

  return variant === 'mini' ? (
    <MiniTimeline panels={panels} onSelect={handleSelect} />
  ) : (
    <FullTimeline panels={panels} onSelect={handleSelect} />
  );
}

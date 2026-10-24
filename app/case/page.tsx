'use client';

import { Suspense, use, useEffect, useMemo } from 'react';
import { CaseHeader } from '@/components/case/case-header';
import { EvidenceGraph } from '@/components/case/evidence-graph';
import { ProgressFeed } from '@/components/progress-feed';
import { StepButtons } from '@/components/step-buttons';
import type { StepId } from '@/lib/steps';
import { useInvestigation, type InvestigationState } from '@/lib/use-investigation';
import { useStepReveal, type StepIndex } from '@/lib/use-step-reveal';

type CaseSearchParams = Pick<PageProps<'/case'>, 'searchParams'>;

const MODE_LABELS: Record<string, string> = {
  mock: '演示立案',
  real: '文字立案',
  demo: '示例卷宗',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 画布当前查看的步骤映射到来源分组；结案时停在自媒体组。 */
function toStepId(step: StepIndex): StepId {
  if (step <= 1) return 1;
  if (step >= 4) return 4;
  return step === 2 ? 2 : 3;
}

function resolveSourceLabel(input: string): string {
  if (!/^https?:\/\//i.test(input)) return '消息原文';

  try {
    return new URL(input).host || '链接';
  } catch {
    return '链接';
  }
}

/** 链接立案时，用第一条检索来源的标题补全来源小卡。 */
function resolveSourceTitle(input: string, state: InvestigationState): string | undefined {
  if (!/^https?:\/\//i.test(input)) return undefined;
  const firstSourceId = state.sourceOrder[0];
  return firstSourceId ? state.sourcesById[firstSourceId]?.title : undefined;
}

function CaseFallback() {
  return (
    <main className="flex h-dvh min-h-[720px] min-w-[1280px] flex-col bg-paper">
      <header className="h-[64px] shrink-0 border-b-[3px] border-ink bg-brand" />
      <div className="grid flex-1 place-items-center">
        <p className="text-sm font-black text-muted">正在调取卷宗…</p>
      </div>
    </main>
  );
}

export default function CasePage({ searchParams }: PageProps<'/case'>) {
  return (
    <Suspense fallback={<CaseFallback />}>
      <CaseContent searchParams={searchParams} />
    </Suspense>
  );
}

function CaseContent({ searchParams }: CaseSearchParams) {
  const params = use(searchParams);
  const { state, start } = useInvestigation();
  const reveal = useStepReveal(state);

  const mode = first(params.mode);
  const text = first(params.text)?.trim();
  const demoId = first(params.demoId);

  useEffect(() => {
    if (mode === 'demo' && demoId) {
      start({ mode: 'demo', demoId });
      return;
    }

    if (mode === 'real' && text) {
      start({ mode: 'real', inputType: 'text', text });
      return;
    }

    start({ mode: 'mock' });
  }, [demoId, mode, start, text]);

  const activeStep = toStepId(reveal.viewStep);
  const closed = state.status === 'done';
  const input = state.input || text || '';
  const modeLabel = MODE_LABELS[mode ?? 'mock'] ?? '文字立案';

  const claim = state.claims[0] ?? null;
  const claimSources = useMemo(() => {
    if (!claim) return [];
    return state.sourceOrder
      .map((id) => state.sourcesById[id])
      .filter((source) => source.claimId === claim.id);
  }, [claim, state.sourceOrder, state.sourcesById]);
  const claimGroups = useMemo(
    () => (claim ? state.groups.filter((group) => group.claimId === claim.id) : []),
    [claim, state.groups],
  );
  const revealStep = (step: StepIndex): StepId | 0 => (step === 0 ? 0 : toStepId(step));

  return (
    <main className="flex h-dvh min-h-[720px] min-w-[1280px] flex-col overflow-hidden bg-paper text-ink">
      <CaseHeader
        caseId={state.caseId}
        input={input}
        modeLabel={modeLabel}
        stats={state.stats}
        activeStep={activeStep}
        closed={closed}
      />

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <ProgressFeed
          sourceLabel={resolveSourceLabel(input)}
          sourceTitle={resolveSourceTitle(input, state)}
          state={state}
          reveal={reveal}
        />

        <EvidenceGraph
          claim={claim}
          sources={claimSources}
          groups={claimGroups}
          timeline={claim ? state.timelines[claim.id] : undefined}
          revealedStep={revealStep(reveal.revealedStep)}
          viewStep={revealStep(reveal.viewStep)}
        />
      </div>

      <div className="shrink-0 px-3 pb-3">
        <StepButtons reveal={reveal} />
      </div>
    </main>
  );
}

'use client';

import { Suspense, use, useEffect } from 'react';
import { CaseHeader } from '@/components/case/case-header';
import { EvidenceGraph } from '@/components/case/evidence-graph';
import { ProgressFeed } from '@/components/case/progress-feed';
import { StepButtons } from '@/components/case/step-buttons';
import { stepOfTier, type StepId } from '@/lib/steps';
import { useInvestigation, type InvestigationState } from '@/lib/use-investigation';

type CaseSearchParams = Pick<PageProps<'/case'>, 'searchParams'>;

const MODE_LABELS: Record<string, string> = {
  mock: '演示立案',
  real: '文字立案',
  demo: '示例卷宗',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 已出现来源里等级最高的一档，决定顶部胶囊和底部步骤条。 */
function resolveActiveStep(state: InvestigationState): StepId {
  return state.sourceOrder.reduce<StepId>((current, id) => {
    const tier = state.sourcesById[id]?.tier;
    if (!tier) return current;
    const next = stepOfTier(tier);
    return next > current ? next : current;
  }, 1);
}

function resolveSourceLabel(input: string): string {
  if (!/^https?:\/\//i.test(input)) return '消息原文';

  try {
    return new URL(input).host || '链接';
  } catch {
    return '链接';
  }
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

  const activeStep = resolveActiveStep(state);
  const closed = state.status === 'done';
  const input = state.input || text || '';
  const modeLabel = MODE_LABELS[mode ?? 'mock'] ?? '文字立案';

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
          logs={state.logs}
          activeStep={activeStep}
          status={state.status}
        />

        <EvidenceGraph
          claims={state.claims}
          sourcesById={state.sourcesById}
          sourceOrder={state.sourceOrder}
          groups={state.groups}
          activeStep={activeStep}
          closed={closed}
        />
      </div>

      <div className="shrink-0 px-3 pb-3">
        <StepButtons
          activeStep={activeStep}
          closed={closed}
          verdictReady={state.verdict !== null && !closed}
        />
      </div>
    </main>
  );
}

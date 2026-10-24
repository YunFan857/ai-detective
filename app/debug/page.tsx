'use client';

import { useInvestigation } from '@/lib/use-investigation';

/**
 * 调试页：只用于本地观察 mock 回放与事件流状态，不参与正式流程。
 */
export default function DebugPage() {
  const { state, start, stop } = useInvestigation();

  const summary = {
    status: state.status,
    caseId: state.caseId,
    currentStage: state.currentStage,
    input: state.input,
    claims: state.claims.length,
    sources: state.sourceOrder.length,
    groups: state.groups.length,
    timelines: Object.keys(state.timelines).length,
    logs: state.logs.length,
    errors: state.errors.length,
    verdict: state.verdict?.level ?? null,
    stats: state.stats,
    latestLog: state.logs.at(-1)?.message ?? null,
  };

  return (
    <main className="paper-bg min-h-dvh px-4 py-10">
      <div className="mx-auto w-full max-w-[860px]">
        <h1 className="text-2xl font-black">调查事件流调试</h1>
        <p className="mt-1 text-sm text-muted">启动 mock 回放，观察 reducer 累积出的卷宗状态。</p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => start({ mode: 'mock' })}
            className="rounded-full border-2 border-ink bg-brand px-5 py-2 text-sm font-black text-white shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            启动 mock 回放
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={state.status !== 'running'}
            className="rounded-full border-2 border-ink bg-card px-5 py-2 text-sm font-black shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
          >
            停止
          </button>
        </div>

        <pre className="mt-5 overflow-auto rounded-xl border-2 border-ink bg-card p-4 text-xs leading-6 shadow-ink-sm">
          {JSON.stringify(summary, null, 2)}
        </pre>
      </div>
    </main>
  );
}

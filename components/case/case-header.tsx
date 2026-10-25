'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DetectiveAnimation } from '@/components/case/detective-animation';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { HomeIcon, LinkIcon } from '@/components/ui/icons';
import { StatsBar } from '@/components/stats-bar';
import { stepById, type StepId } from '@/lib/steps';
import type { InvestigationState } from '@/lib/use-investigation';

/** 上一轮已经敬礼过的办案轮次：返回首页再进来、组件重挂载都不重复播放。 */
let lastSalutedRun: number | null = null;

export type CaseHeaderProps = {
  caseId: string | null;
  input: string;
  modeLabel: string;
  state: InvestigationState;
  activeStep: StepId;
  closed: boolean;
  /** 本次办案已被用户主动终止。 */
  terminated?: boolean;
  /** 办案进行中时顶部「终止办案」的回调。 */
  onTerminate?: () => void;
};

/** 卷宗页顶部绿栏：卷宗号、立案方式、原始消息、统计与当前步骤。 */
export function CaseHeader({
  caseId,
  input,
  modeLabel,
  state,
  activeStep,
  closed,
  terminated = false,
  onTerminate,
}: CaseHeaderProps) {
  const step = stepById(activeStep);
  const [terminateConfirm, setTerminateConfirm] = useState(false);
  const running = state.status === 'running';
  /** 本轮办案的敬礼状态：case 事件到达（startedAt）后播一次，播完恢复头像。 */
  const [salutedRun, setSalutedRun] = useState<number | null>(lastSalutedRun);
  const runKey = running ? state.startedAt : null;
  const salutePlaying = runKey !== null && runKey !== salutedRun;

  const finishSalute = (): void => {
    if (runKey === null) return;
    lastSalutedRun = runKey;
    setSalutedRun(runKey);
  };

  return (
    <header className="flex h-[64px] shrink-0 items-center gap-3 border-b-[3px] border-ink bg-brand px-4">
      <Link
        href="/"
        aria-label="返回首页"
        title="返回首页"
        className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-ink bg-brand-soft transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-card"
      >
        {salutePlaying ? (
          <DetectiveAnimation
            clip="salute"
            playKey={runKey}
            size={40}
            onEnded={finishSalute}
            onUnavailable={finishSalute}
          />
        ) : (
          <DetectiveMascot variant="avatar" className="h-11 w-11 -translate-y-1" />
        )}
      </Link>

      <Link
        href="/"
        aria-label="返回首页"
        className="flex shrink-0 items-center gap-1.5 rounded-xl border-2 border-ink bg-card px-2.5 py-1.5 text-xs font-black whitespace-nowrap text-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
      >
        <HomeIcon className="h-3.5 w-3.5" />
        首页
      </Link>

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

      {running && onTerminate ? (
        terminateConfirm ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full border-2 border-ink bg-coral-soft px-1.5 py-1 text-[11px] font-black whitespace-nowrap text-coral">
            终止后积分退回
            <button
              type="button"
              onClick={() => setTerminateConfirm(false)}
              className="rounded-full border border-ink bg-card px-2 py-0.5 text-[10px] font-black text-ink"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onTerminate}
              className="rounded-full border border-ink bg-coral px-2 py-0.5 text-[10px] font-black text-white"
            >
              确认终止
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setTerminateConfirm(true)}
            className="flex shrink-0 items-center gap-1 rounded-full border-2 border-ink bg-card px-2.5 py-1.5 text-xs font-black whitespace-nowrap text-coral shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <span aria-hidden>■</span>
            终止办案
          </button>
        )
      ) : null}

      {terminated ? (
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border-2 border-ink bg-coral-soft px-3 py-1.5 text-sm font-black whitespace-nowrap text-coral shadow-ink-sm">
          <span aria-hidden>■</span>
          已终止
        </span>
      ) : (
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
      )}
    </header>
  );
}

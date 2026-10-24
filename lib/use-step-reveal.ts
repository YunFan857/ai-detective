'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import { stepOfTier } from '@/lib/steps';
import type { InvestigationState } from '@/lib/use-investigation';

/**
 * 前端展示编排：把后端连成一条的事件流切成 5 个「步」。
 * 0 未开始，1 起点（疑点），2 官方，3 媒体，4 自媒体，5 结案。
 * 不改后端接口，只根据事件到达顺序决定何时揭示。
 */
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

/** auto：满足条件后自动推进；manual：路演者点「下一步」推进。 */
export type StepPace = 'auto' | 'manual';

export type StepRevealResult = {
  /** 已揭示到第几步，0 表示还没开始。 */
  revealedStep: StepIndex;
  /** 画布当前查看的步骤。 */
  viewStep: StepIndex;
  /**
   * 查看某一步。查看最新的已揭示步骤会恢复自动跟随；
   * manual 模式下点「下一步」也会由此推进 revealedStep。
   */
  setViewStep: (step: StepIndex) => void;
  /** 该步是否为进行中的下一步（revealedStep + 1）。 */
  isRunning: (step: StepIndex) => boolean;
  /** 当前节奏，供步骤按钮区分「走访中」与「▶ 下一步」。 */
  pace: StepPace;
  /** 是否仍自动跟随最新一步；false 时画布可显示「回到最新 ▶」胶囊。 */
  isFollowing: boolean;
  /** 恢复自动跟随，并把视图切回最新一步。 */
  followLatest: () => void;
};

/** 每一步至少展示 2.5 秒后才揭示下一步。 */
export const STEP_REVEAL_DELAY_MS = 2500;

/** URL 参数：?pace=manual 时由路演者手动推进（demo / mock 演示用）。 */
export const STEP_PACE_PARAM = 'pace';

const LAST_STEP: StepIndex = 5;

type RevealState = {
  revealed: StepIndex;
  view: StepIndex;
  /** 用户是否处于自动跟随状态；点旧步骤后为 false。 */
  following: boolean;
};

const INITIAL_REVEAL: RevealState = { revealed: 0, view: 0, following: true };

type RevealAction =
  | { type: 'reset' }
  | { type: 'reveal'; step: StepIndex }
  | { type: 'view'; step: StepIndex; pace: StepPace }
  | { type: 'follow' };

function clampStep(step: number): StepIndex {
  if (step <= 0) return 0;
  if (step >= LAST_STEP) return LAST_STEP;
  return Math.round(step) as StepIndex;
}

function nextStep(step: StepIndex): StepIndex {
  return clampStep(step + 1);
}

function revealReducer(state: RevealState, action: RevealAction): RevealState {
  switch (action.type) {
    case 'reset':
      return state.revealed === 0 && state.view === 0 && state.following ? state : INITIAL_REVEAL;

    case 'reveal': {
      const step = clampStep(action.step);
      if (step <= state.revealed) return state;
      // 自动跟随时视图跟着新步骤走；用户在看旧步骤时保持不动。
      return {
        revealed: step,
        view: state.following ? step : state.view,
        following: state.following,
      };
    }

    case 'view': {
      const requested = clampStep(action.step);
      // manual 模式下「下一步」由路演者点击推进。
      const advanceManually = action.pace === 'manual' && requested === state.revealed + 1;
      const revealed = advanceManually ? requested : state.revealed;
      const view = clampStep(Math.min(requested, revealed));
      // 只有查看最新一步时才恢复自动跟随；点旧步骤则停止跟随。
      return { revealed, view, following: view === revealed };
    }

    case 'follow':
      return { revealed: state.revealed, view: state.revealed, following: true };
  }
}

/** 当前节奏来自 URL 参数；用外部存储读取，避免首屏与 SSR 不一致。 */
function subscribePace(): () => void {
  return () => undefined;
}

function getPaceSnapshot(): StepPace {
  return new URLSearchParams(window.location.search).get(STEP_PACE_PARAM) === 'manual'
    ? 'manual'
    : 'auto';
}

function getServerPaceSnapshot(): StepPace {
  return 'auto';
}

/**
 * 调查状态 → 分步揭示。
 * @param state useInvestigation 返回的 state。
 */
export function useStepReveal(state: InvestigationState): StepRevealResult {
  const [reveal, dispatch] = useReducer(revealReducer, INITIAL_REVEAL);
  const pace = useSyncExternalStore(subscribePace, getPaceSnapshot, getServerPaceSnapshot);
  const revealedAtRef = useRef(0);

  // 重新开案或停止调查时回到起点。
  useEffect(() => {
    const restarted =
      state.status === 'idle' ||
      (state.status === 'running' && state.claims.length === 0 && state.sourceOrder.length === 0);
    if (restarted) dispatch({ type: 'reset' });
  }, [state.status, state.claims.length, state.sourceOrder.length]);

  // 记录本轮步骤的揭示时刻，供下一步的 2.5 秒间隔使用。
  // 必须声明在自动推进的 effect 之前，保证同一轮渲染里先更新时间戳。
  useEffect(() => {
    revealedAtRef.current = Date.now();
  }, [reveal.revealed]);

  // claims 到达 → 立即揭示第 1 步；manual 模式交给路演者点「下一步」。
  useEffect(() => {
    if (pace !== 'auto' || state.claims.length === 0) return;
    dispatch({ type: 'reveal', step: 1 });
  }, [pace, state.claims.length]);

  /** 已到达来源的等级分别归到哪一步（官方 → 2，媒体 → 3，其余 → 4）。 */
  const stepsWithSource = useMemo(() => {
    const steps = new Set<StepIndex>();
    for (const source of Object.values(state.sourcesById)) {
      if (source.tier) steps.add(stepOfTier(source.tier));
    }
    return steps;
  }, [state.sourcesById]);

  // 走访（正反搜证）结束：即使某一步没有来源也照常揭示，由画布用灰色贴纸说明。
  const searchDone =
    state.status === 'done' ||
    state.logs.some((log) => log.stage === 'search' && log.status === 'done');
  const hasVerdict = state.verdict !== null;

  // 第 2–5 步：上一步展示满 2.5 秒，且本步条件成立时自动揭示。
  useEffect(() => {
    if (pace !== 'auto' || reveal.revealed === 0 || reveal.revealed === LAST_STEP) return;

    const target = nextStep(reveal.revealed);
    const ready = target === LAST_STEP ? hasVerdict : searchDone || stepsWithSource.has(target);
    if (!ready) return;

    const elapsed = Date.now() - revealedAtRef.current;
    const timer = setTimeout(
      () => dispatch({ type: 'reveal', step: target }),
      Math.max(0, STEP_REVEAL_DELAY_MS - elapsed),
    );

    return () => clearTimeout(timer);
  }, [pace, reveal.revealed, searchDone, stepsWithSource, hasVerdict]);

  const setViewStep = useCallback(
    (step: StepIndex) => dispatch({ type: 'view', step, pace }),
    [pace],
  );

  const followLatest = useCallback(() => dispatch({ type: 'follow' }), []);

  const isRunning = useCallback(
    (step: StepIndex) => clampStep(step) === reveal.revealed + 1,
    [reveal.revealed],
  );

  return {
    revealedStep: reveal.revealed,
    viewStep: reveal.view,
    setViewStep,
    isRunning,
    pace,
    isFollowing: reveal.following,
    followLatest,
  };
}

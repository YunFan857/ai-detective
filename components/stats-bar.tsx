'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from 'framer-motion';
import { clsx } from 'clsx';
import type { InvestigationState } from '@/lib/use-investigation';

export type StatsBarProps = {
  /** 调查状态：走访数随事件流实时累加，stats 事件到达后以其为准校正。 */
  state: InvestigationState;
};

/** 数字滚动时长（秒）与「压缩」强调动画时长（毫秒）。 */
const COUNT_DURATION = 0.5;
const COMPRESS_MS = 900;

/** 数字滚动：值变化时滚到新值，尊重减少动态偏好（直接落位）。 */
function RollingNumber({ value, className }: { value: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(value);
  const [display, setDisplay] = useState(() => String(value));

  useMotionValueEvent(motionValue, 'change', (latest) => {
    setDisplay(String(Math.round(latest)));
  });

  useEffect(() => {
    if (reduceMotion) {
      motionValue.set(value);
      return;
    }

    const controls = animate(motionValue, value, {
      duration: COUNT_DURATION,
      ease: 'easeOut',
    });
    return () => controls.stop();
  }, [motionValue, reduceMotion, value]);

  return <span className={clsx('tabular-nums', className)}>{display}</span>;
}

/** 每秒钟触发一次重绘，用于办案期间「用时」实时走秒。 */
function useLiveClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;

    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  return now;
}

function Separator() {
  return (
    <span aria-hidden className="mx-1.5 opacity-70">
      ·
    </span>
  );
}

/**
 * 顶部栏统计：本案调用元宝搜索 X 次 · 走访 Y 个来源 · 合并为 Z 个独立证人 · 用时 N 秒。
 * 办案期间走访数实时累加；同源合并到达后补出独立证人数，并做一次「压缩」强调动画。
 */
export function StatsBar({ state }: StatsBarProps) {
  const reduceMotion = useReducedMotion();
  const now = useLiveClock(state.status === 'running');
  const [compressing, setCompressing] = useState(false);
  const sawGroupsRef = useRef(false);

  const groupsArrived = state.groups.length > 0;

  // 同源合并首次到达：走访数变红划掉、独立证人数弹出，只做一次。
  useEffect(() => {
    if (!groupsArrived) {
      sawGroupsRef.current = false;
      return;
    }
    if (sawGroupsRef.current) return;
    sawGroupsRef.current = true;
    if (reduceMotion) return;

    const startId = window.setTimeout(() => setCompressing(true), 0);
    const endId = window.setTimeout(() => setCompressing(false), COMPRESS_MS);
    return () => {
      window.clearTimeout(startId);
      window.clearTimeout(endId);
    };
  }, [groupsArrived, reduceMotion]);

  const stats = state.stats;
  const apiCalls = stats?.apiCalls ?? 0;
  const sourcesVisited = stats?.sourcesVisited ?? state.sourceOrder.length;

  /** 独立证人：stats 未到时按「来源数 − 被折叠的转载」估算。 */
  const foldedCount = useMemo(
    () => state.groups.reduce((total, group) => total + Math.max(0, group.memberIds.length - 1), 0),
    [state.groups],
  );
  const witnesses =
    stats?.independentWitnesses ?? Math.max(0, state.sourceOrder.length - foldedCount);

  const elapsedMs = stats
    ? stats.durationMs
    : state.startedAt
      ? (state.closedAt ?? now) - state.startedAt
      : 0;
  const durationSec = Math.max(0, Math.round(elapsedMs / 1000));

  return (
    <p
      aria-label={`本案调用元宝搜索 ${apiCalls} 次，走访 ${sourcesVisited} 个来源${
        groupsArrived ? `，合并为 ${witnesses} 个独立证人` : ''
      }，用时 ${durationSec} 秒`}
      className="flex shrink-0 items-center text-[13px] font-black whitespace-nowrap text-white [text-shadow:1px_1px_0_var(--color-ink)]"
    >
      <span>
        本案调用元宝搜索 <RollingNumber value={apiCalls} /> 次
      </span>

      <Separator />

      <span>
        走访{' '}
        <RollingNumber
          value={sourcesVisited}
          className={compressing ? 'text-red line-through' : undefined}
        />{' '}
        个来源
      </span>

      {groupsArrived ? (
        <>
          <Separator />
          <motion.span
            initial={reduceMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={
              reduceMotion ? { duration: 0.15 } : { type: 'spring', stiffness: 320, damping: 18 }
            }
            className="origin-left"
          >
            合并为 <RollingNumber value={witnesses} /> 个独立证人
          </motion.span>
        </>
      ) : null}

      <Separator />

      <span>
        用时 <RollingNumber value={durationSec} /> 秒
      </span>
    </p>
  );
}

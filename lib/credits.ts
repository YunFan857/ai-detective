'use client';

import { useMemo, useSyncExternalStore } from 'react';
import {
  ensureCreditsLoaded,
  getCreditsServerSnapshot,
  getCreditsSnapshot,
  subscribeCredits,
  type CreditsSnapshot,
  type CreditsStorageIssue,
} from './credits-store';

/**
 * 积分状态的 React 视图。
 * 数据源是 localStorage 的本地演示账本，不再使用 ?demoCredits 之类的临时余额。
 */
export type CreditsView =
  | { status: 'loading' }
  | {
      status: 'ready';
      balance: number;
      source: 'local';
      issue: CreditsStorageIssue | null;
    }
  | { status: 'unavailable'; message: string };

function toView(snapshot: CreditsSnapshot): CreditsView {
  if (snapshot.status === 'loading') return { status: 'loading' };
  return {
    status: 'ready',
    balance: snapshot.balance,
    source: 'local',
    issue: snapshot.issue,
  };
}

/** 完整积分账本（余额、批次、流水、签到状态）。 */
export function useCreditAccount(): CreditsSnapshot {
  return useSyncExternalStore(subscribeCredits, getCreditsSnapshot, getCreditsServerSnapshot);
}

/** 只读余额视图，供自动开查 / 结算栏等旧调用方复用。 */
export function useCredits(): CreditsView {
  const snapshot = useCreditAccount();
  return useMemo(() => toView(snapshot), [snapshot]);
}

/** 非 React 场景读取当前余额；会触发一次客户端初始化。 */
export function readCredits(): CreditsView {
  ensureCreditsLoaded();
  return toView(getCreditsSnapshot());
}

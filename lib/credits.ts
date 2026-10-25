'use client';

import { useSyncExternalStore } from 'react';

/**
 * 前端积分状态（只读视图）。
 * 项目目前没有积分账户模块，所以默认是 unavailable，绝不伪造真实余额。
 * 仅在非生产环境、并且显式开启「开发演示余额」时才会出现 ready 数值，
 * 用于验证余额充足 / 不足 / 加载中 / 倒计时中下降等分支。
 *
 * 开启方式（任选其一，仅 NODE_ENV !== 'production'）：
 * - 访问 /claims?demoCredits=38（数字=演示余额，loading=一直加载中）
 * - sessionStorage.setItem('claims:demo-credits', '38')
 * 开启后控制台可用 window.__claimsDemoCredits.set(n) / .loading() / .unavailable() 改变状态。
 *
 * 接入真实积分模块时，只需替换本文件里的数据来源，调用方（useCredits / readCredits）不变。
 */
export type CreditsView =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'ready'; balance: number; source: 'demo' | 'account' };

const UNAVAILABLE: CreditsView = { status: 'unavailable' };
const DEMO_STORAGE_KEY = 'claims:demo-credits';

type DemoHandle = {
  set: (balance: number) => void;
  loading: () => void;
  unavailable: () => void;
};

declare global {
  interface Window {
    __claimsDemoCredits?: DemoHandle;
  }
}

let current: CreditsView = UNAVAILABLE;
let initialized = false;
const listeners = new Set<() => void>();

function publish(next: CreditsView): void {
  current = next;
  listeners.forEach((listener) => listener());
}

function parseDemo(raw: string | null): CreditsView | null {
  if (raw === null) return null;
  if (raw === 'loading') return { status: 'loading' };
  if (!/^\d{1,9}$/.test(raw)) return null;
  return { status: 'ready', balance: Number(raw), source: 'demo' };
}

function init(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  if (process.env.NODE_ENV === 'production') return;

  let raw: string | null = null;
  try {
    raw = new URLSearchParams(window.location.search).get('demoCredits');
    if (raw === null) raw = window.sessionStorage.getItem(DEMO_STORAGE_KEY);
  } catch {
    raw = null;
  }

  const initial = parseDemo(raw);
  if (!initial) return;

  try {
    // 记住演示余额：跳转 / 返回后 URL 参数消失也保持同一状态。
    if (raw !== null) window.sessionStorage.setItem(DEMO_STORAGE_KEY, raw);
  } catch {
    // 会话存储不可用时忽略
  }

  current = initial;
  window.__claimsDemoCredits = {
    set: (balance) => publish({ status: 'ready', balance, source: 'demo' }),
    loading: () => publish({ status: 'loading' }),
    unavailable: () => publish(UNAVAILABLE),
  };
}

/** 非 React 场景同步读取当前积分状态。 */
export function readCredits(): CreditsView {
  init();
  return current;
}

function subscribe(listener: () => void): () => void {
  init();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCredits(): CreditsView {
  return useSyncExternalStore(subscribe, readCredits, () => UNAVAILABLE);
}

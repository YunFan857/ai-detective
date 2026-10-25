'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCreditAccount } from './credits';
import { checkInCredits, rechargeCredits, type CreditsSnapshot } from './credits-store';
import {
  CREDIT_PACKAGES,
  DEFAULT_PACKAGE_ID,
  findCreditPackage,
  type CreditPackage,
} from './credits-policy';

export type CreditsNotice = {
  tone: 'success' | 'error' | 'info';
  text: string;
} | null;

export type CreditsCenterController = {
  account: CreditsSnapshot;
  packages: readonly CreditPackage[];
  selected: CreditPackage;
  selectedId: string;
  notice: CreditsNotice;
  busy: boolean;
  selectPackage: (id: string) => void;
  checkIn: () => void;
  rechargeSelected: () => void;
  simulatePlus100: () => void;
  dismissNotice: () => void;
};

/** 积分中心的业务状态：套餐选择、签到、模拟充值都集中在这里。 */
export function useCreditsCenter(): CreditsCenterController {
  const account = useCreditAccount();
  const [selectedId, setSelectedId] = useState(DEFAULT_PACKAGE_ID);
  const [notice, setNotice] = useState<CreditsNotice>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const unlockTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (unlockTimerRef.current !== null) {
        window.clearTimeout(unlockTimerRef.current);
      }
    };
  }, []);

  const selected = useMemo(() => findCreditPackage(selectedId) ?? CREDIT_PACKAGES[0], [selectedId]);

  const selectPackage = useCallback((id: string) => {
    setSelectedId(id);
    setNotice(null);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const checkIn = useCallback(() => {
    const result = checkInCredits();
    setNotice({
      tone: result.ok ? 'success' : result.reason === 'already' ? 'info' : 'error',
      text: result.message,
    });
  }, []);

  const runRecharge = useCallback(
    (input: { points: number; priceYuan?: number; label: string }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);

      try {
        const result = rechargeCredits(input);
        setNotice({ tone: result.ok ? 'success' : 'error', text: result.message });
      } finally {
        // 模拟入账是同步的；保留一小段锁，避免同一次点击被浏览器拆成两次事件。
        if (unlockTimerRef.current !== null) {
          window.clearTimeout(unlockTimerRef.current);
        }
        unlockTimerRef.current = window.setTimeout(() => {
          unlockTimerRef.current = null;
          busyRef.current = false;
          setBusy(false);
        }, 800);
      }
    },
    [],
  );

  const rechargeSelected = useCallback(() => {
    runRecharge({
      points: selected.points,
      priceYuan: selected.priceYuan,
      label: `模拟充值 · ${selected.name}`,
    });
  }, [runRecharge, selected]);

  const simulatePlus100 = useCallback(() => {
    runRecharge({ points: 100, label: '模拟充值 · 快捷 +100' });
  }, [runRecharge]);

  return {
    account,
    packages: CREDIT_PACKAGES,
    selected,
    selectedId,
    notice,
    busy,
    selectPackage,
    checkIn,
    rechargeSelected,
    simulatePlus100,
    dismissNotice,
  };
}

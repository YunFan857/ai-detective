'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AutorunController,
  type AutorunSnapshot,
  type StartPayload,
  type StartResult,
} from '@/lib/claims-autorun-controller';
import {
  AUTORUN_SECONDS,
  classifyPreview,
  estimateCost,
  readFlowMarker,
  writeFlowMarker,
  type PickReason,
  type PreviewRoute,
} from '@/lib/claims-autorun-flow';
import { writeClaimsHandoff } from '@/lib/claims-intake';
import { useCredits, type CreditsView } from '@/lib/credits';
import type { ClaimsCheckController } from '@/lib/use-claims-check';
import type { ClaimsPreview } from '@/types/case';

/** 倒计时剩余多少秒起，读屏播报「即将开始」。 */
const ANNOUNCE_SOON_SECONDS = 5;

function subscribeVisibility(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

function getVisible(): boolean {
  return document.visibilityState === 'visible';
}

function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, getVisible, () => true);
}

export type ClaimsAutorunController = {
  /** null=预览还没就绪；其余按分流结果决定渲染 ⑦b、⑦ 还是 0 疑点空态。 */
  route: PreviewRoute | null;
  pickReason: PickReason;
  snapshot: AutorunSnapshot;
  preview: ClaimsPreview | null;
  credits: CreditsView;
  claimCount: number;
  cost: number;
  pricePerClaim: number;
  /** 读屏播报：只在状态转换时变化，不随每秒倒计时变化。 */
  announcement: string;
  /** 原文是否已被改动（与送检版本逐字比较）。 */
  textChanged: boolean;
  recheckError: string | null;
  cancel: () => void;
  startNow: () => StartResult;
  startManual: () => StartResult;
  retryStart: () => StartResult;
  setText: (text: string) => void;
  recheck: () => void;
};

/**
 * ⑦b 自动开查的 React 接入层。
 * UI 不直接 fetch：预检仍由 useClaimsCheck 完成，这里只负责
 * 分流、30 秒倒计时、取消 / 手动开始，以及统一的 startOnce 入口（controller.start）。
 */
export function useClaimsAutorun(check: ClaimsCheckController): ClaimsAutorunController {
  const router = useRouter();
  const credits = useCredits();
  const visible = usePageVisible();
  const [recheckError, setRecheckError] = useState<string | null>(null);

  const preview = check.phase === 'ready' ? check.preview : null;
  const draftId = check.draftId;
  const expectedInput = check.draft?.text;

  const classification = useMemo(
    () => (preview ? classifyPreview(preview, { expectedInput }) : null),
    [preview, expectedInput],
  );

  const subject = useMemo(() => {
    if (!preview || !draftId || classification?.route !== 'autorun') return null;
    return {
      key: `${draftId}:${preview.previewId}`,
      previewId: preview.previewId,
      claimIds: preview.claims.map((claim) => claim.id),
      pricePerClaim: preview.pricePerClaim,
      sourceText: preview.input,
    };
  }, [classification?.route, draftId, preview]);

  const previewRef = useRef<ClaimsPreview | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const subjectKeyRef = useRef<string | null>(null);

  const [controller] = useState(
    () =>
      new AutorunController({
        now: () => Date.now(),
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number),
        begin: () => false,
        onMarker: () => undefined,
        seconds: AUTORUN_SECONDS,
      }),
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  // 先同步环境（积分 / 页面可见性），再配置主体，最后 attach：
  // 避免 configure 时拿到默认的「积分未接入」环境而误判。
  useEffect(() => {
    controller.setEnv({ credits, visible });
  }, [controller, credits, visible]);

  useEffect(() => {
    previewRef.current = preview;
    draftIdRef.current = draftId;
    subjectKeyRef.current = subject?.key ?? null;

    controller.bind({
      begin: (payload: StartPayload) => {
        const current = previewRef.current;
        if (!current || current.previewId !== payload.previewId) return false;
        const saved = writeClaimsHandoff({
          previewId: current.previewId,
          input: current.input,
          selectedClaimIds: payload.claimIds,
          pricePerClaim: payload.pricePerClaim,
        });
        if (!saved) return false;
        // 与 ⑦ 共用同一个办案页入口：/case 读取交接后显式携带 selectedClaimIds 开查。
        router.push('/case?flow=scriptcheck');
        return true;
      },
      onMarker: (status) => {
        const id = draftIdRef.current;
        const current = previewRef.current;
        if (!id || !current) return;
        writeFlowMarker({ draftId: id, previewId: current.previewId, status });
      },
    });

    // 读取到标记 = 这份文案曾经展示过 ⑦b（刷新 / 返回 / 路由回退）：只恢复为手动确认。
    const restored = draftId ? readFlowMarker(draftId) !== null : false;
    controller.configure(subject, restored);
  }, [controller, draftId, preview, router, subject]);

  useEffect(() => {
    controller.attach();
    return () => controller.detach();
  }, [controller]);

  const claimCount = preview?.claims.length ?? 0;
  const pricePerClaim = preview?.pricePerClaim ?? 0;
  const cost = preview ? estimateCost(preview) : 0;
  const sourceText = subject?.sourceText ?? preview?.input ?? '';
  const textChanged = snapshot.text !== sourceText;

  const announcement = useMemo(() => {
    switch (snapshot.phase) {
      case 'counting':
        return snapshot.secondsLeft <= ANNOUNCE_SOON_SECONDS
          ? '即将开始查证，可点击取消。'
          : `发现 ${claimCount} 个疑点，${AUTORUN_SECONDS} 秒后开始查证，将扣 ${cost} 积分。可点击取消。`;
      case 'cancelled-editable':
        return snapshot.manualReason === 'cancelled'
          ? '已取消自动查证，本次未扣积分。你可以修改文案，或手动开始查证。'
          : '';
      case 'stale':
        return '文案已修改，需重新体检。';
      case 'starting':
        return '正在开始查证。';
      case 'error':
        return snapshot.errorMessage ?? '';
      default:
        return '';
    }
  }, [claimCount, cost, snapshot]);

  const cancel = useCallback(() => {
    controller.cancel();
  }, [controller]);
  const startNow = useCallback(() => controller.start('now'), [controller]);
  const startManual = useCallback(() => controller.start('manual'), [controller]);
  const retryStart = useCallback(() => controller.start('retry'), [controller]);
  const setText = useCallback(
    (text: string) => {
      setRecheckError(null);
      controller.setText(text);
    },
    [controller],
  );

  const recheck = useCallback(() => {
    // 只有用户主动点击才会重新免费体检；拿到新预览后才会重新分流 / 倒计时。
    const reason = check.recheck(controller.getSnapshot().text);
    setRecheckError(reason);
  }, [check, controller]);

  return {
    route: classification?.route ?? null,
    pickReason: classification?.pickReason ?? null,
    snapshot,
    preview,
    credits,
    claimCount,
    cost,
    pricePerClaim,
    announcement,
    textChanged,
    recheckError,
    cancel,
    startNow,
    startManual,
    retryStart,
    setText,
    recheck,
  };
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CLAIMS_EDIT_HOME,
  MAX_SELECTED_CLAIMS,
  SCRIPTCHECK_MAX,
  SCRIPTCHECK_MIN,
  readClaimsDraft,
  writeClaimsDraft,
  writeClaimsHandoff,
  type ClaimsDraft,
} from '@/lib/claims-intake';
import {
  countHighRisk,
  defaultSelectedClaimIds,
  highRiskClaimIds,
  selectAllUpToLimit,
  toggleClaimId,
} from '@/lib/claims-selection';
import { releaseCredits, reserveCredits } from '@/lib/credits-store';
import { resetCaseSession } from '@/lib/use-investigation';
import { ClaimsPreviewSchema, type ClaimsPreview } from '@/types/case';

/** 预检是一次性 JSON 请求，超时后明确失败，不靠轮询或假进度。 */
const PREVIEW_TIMEOUT_MS = 120_000;

type Phase = 'reading' | 'missing' | 'loading' | 'error' | 'ready';

export type ClaimsFailure = {
  title: string;
  message: string;
  detail?: string;
};

class PreviewHttpFailure extends Error {
  readonly status: number;
  readonly serverMessage?: string;

  constructor(status: number, serverMessage?: string) {
    super(`预检失败（HTTP ${status}）`);
    this.name = 'PreviewHttpFailure';
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

function isPreviewHttpFailure(error: unknown): error is PreviewHttpFailure {
  return error instanceof PreviewHttpFailure;
}

/** 把 HTTP 状态翻译成用户能采取行动的中文，不暴露内部细节。 */
function httpFailure(status: number, serverMessage?: string): ClaimsFailure {
  if (status === 400) {
    return {
      title: '文案不符合预检要求',
      message: '文案体检支持 50–1500 字，请调整长度后再试。文案已保留。',
      ...(serverMessage ? { detail: serverMessage } : {}),
    };
  }
  if (status === 404) {
    return {
      title: '预检接口不可用',
      message: '当前环境没有找到拆疑点接口，请稍后重试或联系维护者。',
      detail: `HTTP ${status}`,
    };
  }
  if (status === 413) {
    return {
      title: '文案太长了',
      message: '请把文案压缩到 1500 字以内再试。文案已保留。',
      detail: `HTTP ${status}`,
    };
  }
  if (status === 429) {
    return {
      title: '请求太频繁',
      message: '稍等一会儿再重试，文案已保留。',
      detail: `HTTP ${status}`,
    };
  }
  if (status >= 500) {
    return {
      title: '分析服务暂时不可用',
      message:
        '后端已收到请求，但上游模型这次没有给出结果（偶发，通常重试一次即可恢复）。文案已保留。',
      detail: `HTTP ${status}${serverMessage ? ` · ${serverMessage}` : ''}`,
    };
  }
  return {
    title: '预检没有成功',
    message: '请稍后重试，文案已保留。',
    detail: `HTTP ${status}${serverMessage ? ` · ${serverMessage}` : ''}`,
  };
}

async function readServerMessage(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const value = (body as { message?: unknown }).message;
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    // 错误体不是 JSON 时忽略
  }
  return undefined;
}

export type ClaimsCheckController = {
  phase: Phase;
  draft: ClaimsDraft | null;
  preview: ClaimsPreview | null;
  failure: ClaimsFailure | null;
  selectedIds: string[];
  notice: string | null;
  pricePerClaim: number | null;
  confirming: boolean;
  elapsedSeconds: number;
  atLimit: boolean;
  toggle: (claimId: string) => void;
  /** 重叠原文框一次关联多个疑点时，批量勾选 / 取消。 */
  toggleMany: (claimIds: string[]) => void;
  selectHigh: () => void;
  selectAll: () => void;
  clear: () => void;
  confirm: () => void;
  retry: () => void;
  backToEdit: () => void;
  /** 草稿的稳定 id（createdAt）；每次主动提交 / 重新体检都会换新。 */
  draftId: string | null;
  /**
   * ⑦b 修改文案后主动「重新免费体检」：写入新草稿并重新请求预检。
   * 返回 null 表示已发起；否则是给用户看的中文原因，不会发起请求。
   */
  recheck: (text: string) => string | null;
};

/**
 * 文案体检 ⑥/⑦ 的状态机：
 * 读草稿 → 免费预检（可取消 / 重试 / 超时）→ 勾选疑点 → 写交接并进入办案页。
 * 请求在卸载时中止，迟到的响应由序号拦截，不会覆盖新一轮结果。
 */
export function useClaimsCheck(): ClaimsCheckController {
  const router = useRouter();
  const [draft, setDraft] = useState<ClaimsDraft | null>(null);
  const [phase, setPhase] = useState<Phase>('reading');
  const [preview, setPreview] = useState<ClaimsPreview | null>(null);
  const [failure, setFailure] = useState<ClaimsFailure | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const sequenceRef = useRef(0);
  const confirmingRef = useRef(false);

  // 只读一次草稿；StrictMode 二次执行不会覆盖已经读到的对象。
  useEffect(() => {
    let cancelled = false;
    const found = readClaimsDraft();
    queueMicrotask(() => {
      if (cancelled) return;
      setDraft((previous) => previous ?? found);
      if (!found) setPhase('missing');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const draftText = draft?.text ?? null;

  useEffect(() => {
    if (!draftText) return;

    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PREVIEW_TIMEOUT_MS);

    // 状态复位放到微任务里，避免在 effect 内同步触发级联渲染。
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setPhase('loading');
      setFailure(null);
      setPreview(null);
      setSelectedIds([]);
      setNotice(null);
    });

    void (async () => {
      try {
        const response = await fetch('/api/extract-claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'scriptcheck',
            inputType: 'text',
            text: draftText,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const serverMessage = await readServerMessage(response);
          throw new PreviewHttpFailure(response.status, serverMessage);
        }

        const raw: unknown = await response.json();
        if (controller.signal.aborted || sequence !== sequenceRef.current) return;

        const parsed = ClaimsPreviewSchema.safeParse(raw);
        if (!parsed.success) {
          setFailure({
            title: '返回格式异常',
            message: '这次没有拿到可用的疑点清单，请重试。文案已保留。',
            detail: 'ClaimsPreview 校验未通过',
          });
          setPhase('error');
          return;
        }

        setPreview(parsed.data);
        const defaults = defaultSelectedClaimIds(parsed.data.claims);
        const highCount = countHighRisk(parsed.data.claims);
        setSelectedIds(defaults);
        setNotice(
          highCount > MAX_SELECTED_CLAIMS
            ? `共有 ${highCount} 个高风险疑点，一次最多查 ${MAX_SELECTED_CLAIMS} 个，已默认勾选排序前 ${defaults.length} 个。`
            : null,
        );
        setPhase('ready');
      } catch (error) {
        if (sequence !== sequenceRef.current) return;
        if (timedOut) {
          setFailure({
            title: '分析超时',
            message: '等待超过 2 分钟，文案已保留，可以重试或返回编辑。',
          });
          setPhase('error');
          return;
        }
        // 用户取消或组件卸载导致的中止：不写错误态。
        if (controller.signal.aborted) return;

        if (isPreviewHttpFailure(error)) {
          setFailure(httpFailure(error.status, error.serverMessage));
        } else if (error instanceof TypeError) {
          setFailure({
            title: '网络连接中断',
            message: '检查网络后重试，文案已保留。',
          });
        } else {
          setFailure({
            title: '预检没有成功',
            message: '侦探社没有接住这次请求，请重试。文案已保留。',
          });
        }
        setPhase('error');
      } finally {
        window.clearTimeout(timer);
      }
    })();

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draftText, retryTick]);

  // 真实等待时长，只显示「已等待」，不伪造百分比或逐句进度。
  useEffect(() => {
    if (phase !== 'loading') return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const claims = useMemo(() => preview?.claims ?? [], [preview]);
  const atLimit = selectedIds.length >= MAX_SELECTED_CLAIMS;

  const toggle = useCallback(
    (claimId: string) => {
      const result = toggleClaimId(selectedIds, claimId, claims);
      if (result.blocked) {
        setNotice(`一次最多查 ${MAX_SELECTED_CLAIMS} 个疑点，先取消一个再选。`);
        return;
      }
      setNotice(null);
      setSelectedIds(result.ids);
    },
    [claims, selectedIds],
  );

  const toggleMany = useCallback(
    (claimIds: string[]) => {
      const known = new Set(claims.map((claim) => claim.id));
      const unique = [...new Set(claimIds)].filter((id) => known.has(id));
      if (unique.length === 0) return;

      const allSelected = unique.every((id) => selectedIds.includes(id));
      if (allSelected) {
        setSelectedIds(selectedIds.filter((id) => !unique.includes(id)));
        setNotice(null);
        return;
      }

      const additions = unique.filter((id) => !selectedIds.includes(id));
      const room = MAX_SELECTED_CLAIMS - selectedIds.length;
      if (room <= 0) {
        setNotice(`一次最多查 ${MAX_SELECTED_CLAIMS} 个疑点，先取消一个再选。`);
        return;
      }

      const accepted = additions.slice(0, room);
      setSelectedIds([...selectedIds, ...accepted]);
      setNotice(
        accepted.length < additions.length
          ? `一次最多查 ${MAX_SELECTED_CLAIMS} 个疑点，部分疑点未勾选。`
          : null,
      );
    },
    [claims, selectedIds],
  );

  const selectHigh = useCallback(() => {
    const ids = highRiskClaimIds(claims);
    const highCount = countHighRisk(claims);
    setSelectedIds(ids);
    setNotice(
      highCount > MAX_SELECTED_CLAIMS
        ? `共有 ${highCount} 个高风险疑点，一次最多查 ${MAX_SELECTED_CLAIMS} 个，已选排序前 ${ids.length} 个。`
        : ids.length === 0
          ? '没有高风险疑点，请手动勾选要查的项目。'
          : null,
    );
  }, [claims]);

  const selectAll = useCallback(() => {
    const result = selectAllUpToLimit(claims);
    setSelectedIds(result.ids);
    setNotice(
      result.capped
        ? `共 ${claims.length} 个疑点，一次最多查 ${MAX_SELECTED_CLAIMS} 个，已选排序前 ${result.ids.length} 个。`
        : null,
    );
  }, [claims]);

  const clear = useCallback(() => {
    setSelectedIds([]);
    setNotice(null);
  }, []);

  const confirm = useCallback(() => {
    if (!preview || selectedIds.length === 0) return;
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);

    const points = selectedIds.length * preview.pricePerClaim;
    const reservation = reserveCredits({
      points,
      flow: 'scriptcheck',
      note: `文案体检 · ${selectedIds.length} 个疑点 × ${preview.pricePerClaim} 积分`,
    });

    if (!reservation.ok) {
      confirmingRef.current = false;
      setConfirming(false);
      setNotice(
        reservation.reason === 'insufficient'
          ? `${reservation.message} 本次没有发起查证，也没有扣积分。`
          : reservation.message,
      );
      return;
    }

    const saved = writeClaimsHandoff({
      previewId: preview.previewId,
      input: preview.input,
      selectedClaimIds: selectedIds,
      pricePerClaim: preview.pricePerClaim,
      transactionId: reservation.transactionId,
    });

    if (!saved) {
      releaseCredits(reservation.transactionId, '疑点交接失败，预占积分已退回');
      confirmingRef.current = false;
      setConfirming(false);
      setNotice('浏览器会话存储不可用，无法交接疑点，预占积分已退回。');
      return;
    }

    resetCaseSession();
    router.push('/case?flow=scriptcheck');
  }, [preview, router, selectedIds]);

  const retry = useCallback(() => {
    setRetryTick((value) => value + 1);
  }, []);

  const backToEdit = useCallback(() => {
    router.push(CLAIMS_EDIT_HOME);
  }, [router]);

  const recheck = useCallback((text: string): string | null => {
    // 与首页提交一致：送检版本是 trim 后的文本，预览的 span 也对应这一版。
    const length = text.trim().length;
    if (length < SCRIPTCHECK_MIN || length > SCRIPTCHECK_MAX) {
      return `文案体检支持 ${SCRIPTCHECK_MIN}–${SCRIPTCHECK_MAX} 字，当前 ${length} 字。`;
    }
    if (!writeClaimsDraft(text)) {
      return '浏览器会话存储不可用，无法重新体检，请刷新页面后重试。';
    }
    const next = readClaimsDraft();
    if (!next) return '没能保存修改后的文案，请重试。';

    setDraft(next);
    // 与旧预览同批清空：避免旧预览对着新草稿多渲染一帧。
    setPreview(null);
    setSelectedIds([]);
    setFailure(null);
    setNotice(null);
    setPhase('loading');
    // 文本可能与上一版 trim 后相同（只改了空白）：显式递增，保证一定重新请求。
    setRetryTick((value) => value + 1);
    return null;
  }, []);

  return {
    draftId: draft ? String(draft.createdAt) : null,
    recheck,
    phase,
    draft,
    preview,
    failure,
    selectedIds,
    notice,
    pricePerClaim: preview?.pricePerClaim ?? null,
    confirming,
    elapsedSeconds,
    atLimit,
    toggle,
    toggleMany,
    selectHigh,
    selectAll,
    clear,
    confirm,
    retry,
    backToEdit,
  };
}

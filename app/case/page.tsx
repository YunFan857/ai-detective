'use client';

import Link from 'next/link';
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CaseError } from '@/components/case/case-error';
import { CaseHeader } from '@/components/case/case-header';
import { ClaimReviewDialog } from '@/components/case/claim-review-dialog';
import { EvidenceGraph } from '@/components/case/evidence-graph';
import { ImageFailureDialog } from '@/components/case/image-failure-dialog';
import { InterruptedBanner } from '@/components/case/interrupted-banner';
import { ClaimsStateCard } from '@/components/claims/claims-state-card';
import { ProgressFeed } from '@/components/progress-feed';
import { ShareCardDialog } from '@/components/share-card';
import { StepButtons } from '@/components/step-buttons';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { VerdictPanel } from '@/components/verdict-panel';
import { clearClaimsHandoff, readClaimsHandoff, type ClaimsHandoff } from '@/lib/claims-intake';
import { clearCreditsIntake, readCreditsIntake, type CreditsIntake } from '@/lib/credits-intake';
import { useCredits } from '@/lib/credits';
import { releaseCredits, reserveCredits, settleCredits } from '@/lib/credits-store';
import { FACTCHECK_RESERVE_POINTS } from '@/lib/credits-policy';
import type { StepId } from '@/lib/steps';
import {
  useInvestigation,
  isCaseSessionBlocked,
  terminateActiveCase,
  useCaseTermination,
  type ActiveCaseSession,
  type InvestigationFailure,
  type InvestigationState,
} from '@/lib/use-investigation';
import { useStepReveal, type StepIndex } from '@/lib/use-step-reveal';
import { ClaimsPreviewSchema, type ClaimsPreview } from '@/types/case';

type CaseSearchParams = Pick<PageProps<'/case'>, 'searchParams'>;

const MODE_LABELS: Record<string, string> = {
  mock: '演示立案',
  real: '文字立案',
  demo: '示例卷宗',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 画布当前查看的步骤映射到来源分组；结案时停在自媒体组。 */
function toStepId(step: StepIndex): StepId {
  if (step <= 1) return 1;
  if (step >= 4) return 4;
  return step === 2 ? 2 : 3;
}

function resolveSourceLabel(input: string): string {
  if (!/^https?:\/\//i.test(input)) return '消息原文';

  try {
    return new URL(input).host || '链接';
  } catch {
    return '链接';
  }
}

/** 链接立案时，用第一条检索来源的标题补全来源小卡。 */
function resolveSourceTitle(input: string, state: InvestigationState): string | undefined {
  if (!/^https?:\/\//i.test(input)) return undefined;
  const firstSourceId = state.sourceOrder[0];
  return firstSourceId ? state.sourcesById[firstSourceId]?.title : undefined;
}

const IMAGE_STORAGE_KEY = 'intake-image';

/** 图片立案失败时给用户看的文案：识别失败优先引导改用文字。 */
function imageFailureCopy(failure: InvestigationFailure): {
  title: string;
  message: string;
  detail: string;
} {
  if (failure.kind === 'http') {
    if (failure.status === 400 || failure.status === 422) {
      return {
        title: '截图没认出来',
        message: '换一张文字更清楚的截图，或者直接把消息文字粘贴过来。',
        detail: `错误代码：HTTP ${failure.status}`,
      };
    }
    if (failure.status === 413) {
      return {
        title: '截图太大了',
        message: '压缩后还是超出限制，截小一点再试，或者直接粘贴文字。',
        detail: `错误代码：HTTP ${failure.status}`,
      };
    }
    if (failure.status === 501) {
      return {
        title: '图片查证能力尚未部署',
        message: '截图已提交，但图片查证能力尚未部署。先把消息文字粘贴过来，同样可以查证。',
        detail: `错误代码：HTTP ${failure.status}`,
      };
    }
    if (failure.status === 404) {
      return {
        title: '截图预览已失效',
        message: '刚才确认的疑点没保存住，重新上传这张截图再走一遍就好。',
        detail: `错误代码：HTTP ${failure.status}`,
      };
    }

    return {
      title: '图片立案失败',
      message: '侦探社暂时没接住这张截图，换张图或改成文字再试。',
      detail: `错误代码：HTTP ${failure.status}`,
    };
  }

  return {
    title: '截图没认出来',
    message: '这张截图没能识别成可查证的文本，换张清晰的图或直接粘贴文字。',
    detail: failure.message,
  };
}

/** 图片立案第 1 步：先拆疑点、等用户确认，再进入深查。 */
type ReviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: ClaimsPreview; image: string; selected: string[] }
  | { status: 'error'; failure: InvestigationFailure };

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
  const router = useRouter();
  const { state, start } = useInvestigation();
  const reveal = useStepReveal(state);

  const mode = first(params.mode);
  const text = first(params.text)?.trim();
  const demoId = first(params.demoId);
  const inputParam = first(params.input);
  const imageMode = mode === 'real' && inputParam === 'image';
  /** 文案体检用独立 flow 参数，不和 mock/real/demo 混用。 */
  const scriptcheckFlow = first(params.flow) === 'scriptcheck';

  const [verdictOpen, setVerdictOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewState | null>(
    imageMode ? { status: 'loading' } : null,
  );
  const [handoffMissing, setHandoffMissing] = useState(false);
  const [scriptInput, setScriptInput] = useState('');
  const [creditError, setCreditError] = useState<string | null>(null);
  const [factcheckCreditState, setFactcheckCreditState] = useState<
    'unknown' | 'reserved' | 'unconfirmed'
  >('unknown');
  const [focusRequest, setFocusRequest] = useState<{
    sourceId: string;
    nonce: number;
  } | null>(null);
  const autoOpenedRef = useRef(false);
  const imageRef = useRef<string | null>(null);
  const credits = useCredits();
  /** 用户确认过的疑点；「重新调查」用它直接深查，不再重跑识别。 */
  const confirmedRef = useRef<{
    previewId: string;
    selectedClaimIds: string[];
    pricePerClaim: number;
    /** 截图识别出的原文，用于首页「正在立案」提示。 */
    input: string;
  } | null>(null);
  /** 文案体检的已确认预览；只读一次，刷新后不重复开查。 */
  const handoffRef = useRef<ClaimsHandoff | null>(null);
  /** 消息查证的积分预占交接；只读一次。 */
  const factcheckIntakeRef = useRef<CreditsIntake | null>(null);
  const factcheckIntakeCheckedRef = useRef(false);
  /** 当前案件的本地积分交易；结算 / 退回后不重复扣费。 */
  const paidTransactionRef = useRef<string | null>(null);

  /** 本页对应的办案地址：只有真实查证登记到首页；演示 / mock 不登记。 */
  const caseHref = useMemo(() => {
    if (scriptcheckFlow) return '/case?flow=scriptcheck';
    if (imageMode) return '/case?mode=real&input=image';
    if (mode === 'real' && text) return `/case?mode=real&text=${encodeURIComponent(text)}`;
    return null;
  }, [imageMode, mode, scriptcheckFlow, text]);

  const modeLabel = scriptcheckFlow
    ? '文案体检'
    : imageMode
      ? '图片立案'
      : (MODE_LABELS[mode ?? 'mock'] ?? '文字立案');

  /** 本案是否已被终止：终止后顶部显示「已终止」，不再看起来还在跑。 */
  const terminated = useCaseTermination(caseHref);

  /** 首页终止办案时：退回本案预占积分并收起可能开着的弹层。 */
  const handleTermination = useCallback(() => {
    const transactionId = paidTransactionRef.current;
    if (transactionId) {
      releaseCredits(transactionId, '终止办案，预占积分已退回');
      paidTransactionRef.current = null;
    }
    setVerdictOpen(false);
    setShareOpen(false);
  }, []);

  /** 首页需要的办案会话；拿不到真实地址（mock / demo）时不登记。 */
  const sessionFor = useCallback(
    (inputText: string): ActiveCaseSession | undefined =>
      caseHref
        ? {
            href: caseHref,
            input: inputText,
            label: modeLabel,
            onTerminate: handleTermination,
          }
        : undefined,
    [caseHref, handleTermination, modeLabel],
  );

  /** 按当前 URL 参数开案；图片先走拆疑点，确认后再深查。 */
  const startCase = useCallback(() => {
    if (scriptcheckFlow) {
      const handoff = handoffRef.current;
      if (!handoff) return;
      start(
        {
          flow: 'preview',
          mode: 'scriptcheck',
          inputType: 'text',
          text: handoff.input,
          previewId: handoff.previewId,
          selectedClaimIds: handoff.selectedClaimIds,
        },
        sessionFor(handoff.input),
      );
      return;
    }

    if (mode === 'demo' && demoId) {
      start({ mode: 'demo', demoId });
      return;
    }

    if (imageMode) {
      const image = imageRef.current;
      const confirmed = confirmedRef.current;
      if (image && confirmed) {
        start(
          {
            mode: 'real',
            inputType: 'image',
            image,
            previewId: confirmed.previewId,
            selectedClaimIds: confirmed.selectedClaimIds,
          },
          sessionFor(confirmed.input),
        );
      }
      return;
    }

    if (mode === 'real' && text) {
      start({ mode: 'real', inputType: 'text', text }, sessionFor(text));
      return;
    }

    start({ mode: 'mock' });
  }, [demoId, imageMode, mode, scriptcheckFlow, sessionFor, start, text]);

  useEffect(() => {
    // 首页「正在立案」回到本页、或刚被终止：沿用模块里的调查状态，不重复开同一案。
    if (caseHref && isCaseSessionBlocked(caseHref)) return;

    if (scriptcheckFlow) {
      // StrictMode 第二次执行直接用内存里的交接，不再读一次会话存储。
      if (handoffRef.current) {
        const restored = handoffRef.current.input;
        paidTransactionRef.current = handoffRef.current.transactionId ?? null;
        let cancelled = false;
        // 推迟到微任务再开查：StrictMode 首轮 effect 的清理会取消这次调度，
        // 只有第二轮真正执行，避免一次操作发出两次查证请求。
        queueMicrotask(() => {
          if (cancelled) return;
          setScriptInput(restored);
          startCase();
        });
        return () => {
          cancelled = true;
        };
      }

      const handoff = readClaimsHandoff();
      if (!handoff) {
        let cancelled = false;
        queueMicrotask(() => {
          if (!cancelled) setHandoffMissing(true);
        });
        return () => {
          cancelled = true;
        };
      }

      // 读取后立即删除：刷新或前进后退不会重复开查、重复扣费。
      clearClaimsHandoff();
      handoffRef.current = handoff;
      paidTransactionRef.current = handoff.transactionId ?? null;
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setScriptInput(handoff.input);
        startCase();
      });
      return () => {
        cancelled = true;
      };
    }

    if (!imageMode) {
      // 消息查证：首页已在跳转前按上限预占积分，这里只读一次交接。
      if (mode === 'real' && text) {
        if (!factcheckIntakeCheckedRef.current) {
          factcheckIntakeCheckedRef.current = true;
          const intake = readCreditsIntake();
          clearCreditsIntake();

          if (intake && intake.input.trim() === text) {
            factcheckIntakeRef.current = intake;
            paidTransactionRef.current = intake.transactionId;
            queueMicrotask(() => setFactcheckCreditState('reserved'));
          } else {
            // 带 text 直接打开 / 刷新：没有预占就不扣本地积分，避免重复扣费。
            if (intake) {
              releaseCredits(intake.transactionId, '立案文案不一致，预占积分已退回');
            }
            factcheckIntakeRef.current = null;
            paidTransactionRef.current = null;
            queueMicrotask(() => setFactcheckCreditState('unconfirmed'));
          }
        }
      }

      startCase();
      return;
    }

    // StrictMode 会重跑这个 effect：第一次读完即删，第二次直接用内存里的图片。
    let stored = imageRef.current;
    if (!stored) {
      try {
        stored = sessionStorage.getItem(IMAGE_STORAGE_KEY);
        if (stored) sessionStorage.removeItem(IMAGE_STORAGE_KEY);
      } catch {
        stored = null;
      }

      if (!stored) {
        router.replace('/?notice=image-expired');
        return;
      }
    }

    const image = stored;
    imageRef.current = image;

    // 第 1 步：先转写截图并拆疑点，交用户确认后才深查。
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/extract-claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'factcheck', inputType: 'image', image }),
          signal: controller.signal,
        });

        if (!response.ok) {
          if (!controller.signal.aborted) {
            setReview({
              status: 'error',
              failure: {
                kind: 'http',
                status: response.status,
                message: `拆解疑点失败（HTTP ${response.status}）`,
              },
            });
          }
          return;
        }

        const raw: unknown = await response.json();
        const parsed = ClaimsPreviewSchema.safeParse(raw);
        if (!parsed.success) {
          if (!controller.signal.aborted) {
            setReview({
              status: 'error',
              failure: { kind: 'server', message: '拆解疑点返回格式不正确' },
            });
          }
          return;
        }

        if (!controller.signal.aborted) {
          setReview({
            status: 'ready',
            preview: parsed.data,
            image,
            selected: parsed.data.claims.map((claim) => claim.id),
          });
        }
      } catch {
        if (controller.signal.aborted) return;
        setReview({
          status: 'error',
          failure: { kind: 'network', message: '网络连接中断，请检查网络后重试' },
        });
      }
    })();

    return () => controller.abort();
  }, [caseHref, imageMode, mode, router, scriptcheckFlow, startCase, text]);

  /**
   * 本地积分结算：
   * - 收到 billing 即按 charged - refunded 结算，billing 和 done 重复到达由 store 幂等；
   * - done 但没有 billing：按 0 费用退回预占；
   * - 终止失败（网络 / 流中断 / 服务端不可恢复）：退回预占，不因可恢复 error 退款。
   */
  useEffect(() => {
    const transactionId = paidTransactionRef.current;
    if (!transactionId) return;

    if (state.billing) {
      settleCredits(transactionId, state.billing, state.caseId ?? undefined);
      return;
    }
    if (state.status === 'done') {
      releaseCredits(transactionId, '结案未收到结算结果，预占积分已退回');
      return;
    }
    if (state.failure) {
      releaseCredits(transactionId, '查证中止，预占积分已退回');
    }
  }, [state.billing, state.caseId, state.failure, state.status]);

  /**
   * 判决书自动弹出一次：分步揭示到第 5 步，或卷宗已经结案（重新进入本页时
   * 揭示进度会从头播，若只等第 5 步会迟迟不弹）。之后由底部「结案！」按钮重新打开。
   */
  useEffect(() => {
    if (!state.verdict) return;
    if (reveal.revealedStep < 5 && state.status !== 'done') return;
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setVerdictOpen(true);
  }, [reveal.revealedStep, state.status, state.verdict]);

  /**
   * Cache Components 会保留办案页状态：从首页连续打开多个卷宗回放时组件不会重挂载，
   * 上一案留下的「已自动弹过」标记会让后续案件不再弹判决书。这里在新案开始时重置。
   */
  useEffect(() => {
    if (state.status !== 'running' || state.claims.length > 0) return;
    autoOpenedRef.current = false;
    setVerdictOpen(false);
  }, [state.status, state.claims.length]);

  const activeStep = toStepId(reveal.viewStep);
  const closed = state.status === 'done';
  const input = state.input || text || scriptInput || '';
  const creditMode: 'charged' | 'demo' | 'unconfirmed' =
    scriptcheckFlow || imageMode
      ? 'charged'
      : mode === 'real' && text
        ? factcheckCreditState === 'unconfirmed'
          ? 'unconfirmed'
          : 'charged'
        : 'demo';
  /** 图片识别失败或服务端不可恢复错误：交给专用弹窗，不再整页报错。 */
  const imageFailure =
    imageMode && state.failure && (state.failure.kind === 'http' || state.failure.kind === 'server')
      ? state.failure
      : null;
  /** HTTP 错误没有收到任何事件，整页提示并给返回首页。 */
  const httpFailure = !imageMode && state.failure?.kind === 'http' ? state.failure : null;
  /** 网络 / 流意外结束：顶部横幅保留现场并允许重新调查。 */
  const interrupted =
    !imageFailure && state.failure && state.failure.kind !== 'http' ? state.failure : null;
  const imageFailureInfo = imageFailure ? imageFailureCopy(imageFailure) : null;
  /** 拆疑点阶段的失败：同样复用图片失败弹窗的文案与操作。 */
  const reviewFailureInfo = review?.status === 'error' ? imageFailureCopy(review.failure) : null;
  const emptyCase = state.status === 'done' && state.claims.length === 0;

  const claim = state.claims.find((item) => item.id === activeClaimId) ?? state.claims[0] ?? null;
  const claimSources = useMemo(() => {
    if (!claim) return [];
    return state.sourceOrder
      .map((id) => state.sourcesById[id])
      .filter((source) => source.claimId === claim.id);
  }, [claim, state.sourceOrder, state.sourcesById]);
  const claimGroups = useMemo(
    () => (claim ? state.groups.filter((group) => group.claimId === claim.id) : []),
    [claim, state.groups],
  );
  const revealStep = (step: StepIndex): StepId | 0 => (step === 0 ? 0 : toStepId(step));

  /** 判决书里展示的第一条非空时间线。 */
  const verdictTimeline = useMemo(() => {
    for (const item of state.claims) {
      const steps = state.timelines[item.id];
      if (steps && steps.length > 0) return steps;
    }
    return [];
  }, [state.claims, state.timelines]);

  const handleSelectSource = useCallback(
    (sourceId: string, stepId: StepId) => {
      setVerdictOpen(false);

      const source = state.sourcesById[sourceId];
      if (source && source.claimId !== claim?.id) {
        setActiveClaimId(source.claimId);
      }

      reveal.setViewStep(stepId);
      setFocusRequest((previous) => ({
        sourceId,
        nonce: (previous?.nonce ?? 0) + 1,
      }));
    },
    [claim?.id, reveal, state.sourcesById],
  );

  const handleCloseVerdict = useCallback(() => setVerdictOpen(false), []);

  /** 打开分享卡时先收起判决书，关闭后再回到判决书，避免两个弹层抢 Esc。 */
  const handleOpenShareCard = useCallback(() => {
    setVerdictOpen(false);
    setShareOpen(true);
  }, []);

  const handleCloseShareCard = useCallback(() => {
    setShareOpen(false);
    setVerdictOpen(true);
  }, []);

  /** 中断后重新立案：先退回旧预占，再按当前入口重新预占并复用参数重跑。 */
  const handleRetry = useCallback(() => {
    setVerdictOpen(false);
    setShareOpen(false);
    autoOpenedRef.current = false;
    setFocusRequest(null);
    setCreditError(null);

    if (paidTransactionRef.current) {
      releaseCredits(paidTransactionRef.current, '重新查证，旧预占已退回');
      paidTransactionRef.current = null;
    }

    let reservationInput: {
      points: number;
      flow: 'scriptcheck' | 'image' | 'factcheck';
      note: string;
    } | null = null;

    if (scriptcheckFlow) {
      const handoff = handoffRef.current;
      if (!handoff) return;
      reservationInput = {
        points: handoff.selectedClaimIds.length * handoff.pricePerClaim,
        flow: 'scriptcheck',
        note: `文案体检重新查证 · ${handoff.selectedClaimIds.length} 个疑点`,
      };
    } else if (imageMode) {
      const confirmed = confirmedRef.current;
      if (!confirmed || !imageRef.current) return;
      reservationInput = {
        points: confirmed.selectedClaimIds.length * confirmed.pricePerClaim,
        flow: 'image',
        note: `图片立案重新查证 · ${confirmed.selectedClaimIds.length} 个疑点`,
      };
    } else if (mode === 'real' && text && factcheckIntakeRef.current) {
      reservationInput = {
        points: FACTCHECK_RESERVE_POINTS,
        flow: 'factcheck',
        note: '消息查证重新预占 · 自动模式最多 3 个疑点',
      };
    }

    if (reservationInput) {
      const reservation = reserveCredits(reservationInput);
      if (!reservation.ok) {
        setCreditError(`${reservation.message} 本次没有重新发起查证。`);
        return;
      }
      paidTransactionRef.current = reservation.transactionId;
    }

    startCase();
  }, [imageMode, mode, scriptcheckFlow, startCase, text]);

  /** 图片失败后改为文字：回首页，默认停在文字页签。 */
  const handleSwitchToText = useCallback(() => {
    router.push('/');
  }, [router]);

  /** 图片失败后换图：回首页并直接打开图片页签。 */
  const handleRetryImage = useCallback(() => {
    router.push('/?notice=image-retry');
  }, [router]);

  const handleToggleClaim = useCallback((claimId: string) => {
    setReview((current) => {
      if (!current || current.status !== 'ready') return current;
      const selected = current.selected.includes(claimId)
        ? current.selected.filter((id) => id !== claimId)
        : [...current.selected, claimId];
      return { ...current, selected };
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setReview((current) => {
      if (!current || current.status !== 'ready') return current;
      const all = current.preview.claims.map((claim) => claim.id);
      return { ...current, selected: current.selected.length === all.length ? [] : all };
    });
  }, []);

  /** 用户确认疑点后才真正开案；之后「重新调查」复用同一批疑点。 */
  const handleConfirmClaims = useCallback(() => {
    if (!review || review.status !== 'ready' || review.selected.length === 0) return;
    const image = imageRef.current;
    if (!image) return;

    setCreditError(null);
    if (paidTransactionRef.current) {
      releaseCredits(paidTransactionRef.current, '重新确认疑点，旧预占已退回');
      paidTransactionRef.current = null;
    }

    const pricePerClaim = review.preview.pricePerClaim;
    const reservation = reserveCredits({
      points: review.selected.length * pricePerClaim,
      flow: 'image',
      note: `图片立案 · ${review.selected.length} 个疑点 × ${pricePerClaim} 积分`,
    });
    if (!reservation.ok) {
      setCreditError(`${reservation.message} 本次不会发起深查，也没有扣积分。`);
      return;
    }

    paidTransactionRef.current = reservation.transactionId;
    confirmedRef.current = {
      previewId: review.preview.previewId,
      selectedClaimIds: review.selected,
      pricePerClaim,
      input: review.preview.input,
    };
    setReview(null);
    start(
      {
        mode: 'real',
        inputType: 'image',
        image,
        previewId: review.preview.previewId,
        selectedClaimIds: review.selected,
      },
      sessionFor(review.preview.input),
    );
  }, [review, sessionFor, start]);

  if (scriptcheckFlow && (handoffMissing || httpFailure)) {
    const expired = handoffMissing || httpFailure?.status === 404 || httpFailure?.status === 400;
    return (
      <main className="flex h-dvh min-h-[720px] min-w-[1280px] flex-col overflow-hidden bg-paper text-ink">
        <ClaimsStateCard
          mood="yawn"
          eyebrow="文案体检 · 查证未开始"
          title={expired ? '疑点清单已失效' : '查证没有开始'}
          description={
            expired
              ? '刚才确认的疑点没有保存住，或预览已过期。回到文案体检重新分析一次，再勾选要查的项目。'
              : '服务端没有接受这次查证请求，请重新体检后再试。'
          }
          detail={httpFailure ? `错误代码：HTTP ${httpFailure.status}` : undefined}
          primaryLabel="重新体检"
          onPrimary={() => router.push('/claims')}
          secondaryLabel="返回首页"
          onSecondary={() => router.push('/')}
        />
      </main>
    );
  }

  if (httpFailure) {
    return (
      <main className="flex h-dvh min-h-[720px] min-w-[1280px] flex-col overflow-hidden bg-paper text-ink">
        <CaseError status={httpFailure.status} />
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-[720px] min-w-[1280px] flex-col overflow-hidden bg-paper text-ink">
      <ErrorBoundary label="顶部卷宗栏" className="h-[64px] shrink-0">
        <CaseHeader
          caseId={state.caseId}
          input={input}
          modeLabel={modeLabel}
          state={state}
          activeStep={activeStep}
          closed={closed}
          terminated={terminated}
          onTerminate={terminateActiveCase}
        />
      </ErrorBoundary>

      {terminated ? (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b-2 border-ink bg-coral-soft px-3 py-2 text-xs font-black text-coral"
        >
          <span className="min-w-0 flex-1">
            本次办案已终止，未结算的预占积分已退回。
          </span>
          <Link
            href="/"
            className="shrink-0 rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[10px] font-black text-ink shadow-ink-sm"
          >
            返回首页重新立案 →
          </Link>
        </div>
      ) : null}

      {interrupted ? (
        <ErrorBoundary label="线索中断提示">
          <InterruptedBanner message={interrupted.message} onRetry={handleRetry} />
        </ErrorBoundary>
      ) : null}

      {creditError ? (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b-2 border-ink bg-coral-soft px-3 py-2 text-xs font-black text-coral"
        >
          <span className="min-w-0 flex-1">⚠️ {creditError}</span>
          <Link
            href="/credits"
            className="shrink-0 rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[10px] font-black text-ink shadow-ink-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
          >
            去积分中心 →
          </Link>
          <button
            type="button"
            onClick={() => setCreditError(null)}
            className="shrink-0 rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[10px] font-black text-ink shadow-ink-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
          >
            关闭
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <ErrorBoundary label="办案实况" className="w-[300px] shrink-0">
          <ProgressFeed
            sourceLabel={
              scriptcheckFlow ? '文案原文' : imageMode ? '截图识别' : resolveSourceLabel(input)
            }
            sourceTitle={
              scriptcheckFlow || imageMode ? undefined : resolveSourceTitle(input, state)
            }
            sourceImage={
              !scriptcheckFlow && imageMode ? (state.inputImage ?? undefined) : undefined
            }
            state={state}
            reveal={reveal}
            creditsMode={creditMode}
          />
        </ErrorBoundary>

        <ErrorBoundary label="证据图谱" className="min-h-0 min-w-0 flex-1">
          <EvidenceGraph
            claim={claim}
            sources={claimSources}
            groups={claimGroups}
            timeline={claim ? state.timelines[claim.id] : undefined}
            revealedStep={revealStep(reveal.revealedStep)}
            viewStep={revealStep(reveal.viewStep)}
            focusSourceId={focusRequest?.sourceId ?? null}
            focusNonce={focusRequest?.nonce}
            empty={emptyCase}
          />
        </ErrorBoundary>
      </div>

      <div className="shrink-0 px-3 pb-3">
        <ErrorBoundary label="办案步骤" className="w-full">
          <StepButtons reveal={reveal} onOpenVerdict={() => setVerdictOpen(true)} />
        </ErrorBoundary>
      </div>

      <ErrorBoundary label="判决书" className="fixed inset-0 z-[55] m-auto h-fit w-[320px]">
        <VerdictPanel
          open={verdictOpen}
          verdict={state.verdict}
          claims={state.claims}
          sourcesById={state.sourcesById}
          sourceOrder={state.sourceOrder}
          timeline={verdictTimeline}
          onClose={handleCloseVerdict}
          onSelectSource={handleSelectSource}
          onGenerateDebunkCard={handleOpenShareCard}
        />
      </ErrorBoundary>

      <ErrorBoundary label="辟谣卡片" className="fixed inset-0 z-[65] m-auto h-fit w-[320px]">
        <ShareCardDialog
          open={shareOpen}
          verdict={state.verdict}
          sourcesById={state.sourcesById}
          sourceOrder={state.sourceOrder}
          onClose={handleCloseShareCard}
        />
      </ErrorBoundary>

      {review && review.status !== 'error' ? (
        <ErrorBoundary label="疑点确认">
          <ClaimReviewDialog
            open
            loading={review.status === 'loading'}
            image={review.status === 'ready' ? review.image : undefined}
            input={review.status === 'ready' ? review.preview.input : undefined}
            claims={review.status === 'ready' ? review.preview.claims : []}
            selectedIds={review.status === 'ready' ? review.selected : []}
            pricePerClaim={review.status === 'ready' ? review.preview.pricePerClaim : undefined}
            availablePoints={credits.status === 'ready' ? credits.balance : null}
            creditError={creditError}
            onToggle={handleToggleClaim}
            onToggleAll={handleToggleAll}
            onConfirm={handleConfirmClaims}
            onSwitchToText={handleSwitchToText}
            onRetryUpload={handleRetryImage}
          />
        </ErrorBoundary>
      ) : null}

      {reviewFailureInfo ? (
        <ErrorBoundary label="拆解疑点失败">
          <ImageFailureDialog
            open
            title={reviewFailureInfo.title}
            message={reviewFailureInfo.message}
            detail={reviewFailureInfo.detail}
            onSwitchToText={handleSwitchToText}
            onRetryUpload={handleRetryImage}
          />
        </ErrorBoundary>
      ) : null}

      {imageFailureInfo ? (
        <ErrorBoundary label="图片立案失败">
          <ImageFailureDialog
            open
            title={imageFailureInfo.title}
            message={imageFailureInfo.message}
            detail={imageFailureInfo.detail}
            onSwitchToText={handleSwitchToText}
            onRetryUpload={handleRetryImage}
          />
        </ErrorBoundary>
      ) : null}
    </main>
  );
}

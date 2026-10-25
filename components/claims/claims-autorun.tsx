'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ClaimMarkedText } from '@/components/claims/claim-marked-text';
import { ComicButton } from '@/components/ui/comic-button';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { AUTORUN_SECONDS } from '@/lib/claims-autorun-flow';
import { SCRIPTCHECK_MAX, SCRIPTCHECK_MIN } from '@/lib/claims-intake';
import { buildClaimMarks } from '@/lib/claims-span';
import type { ClaimsAutorunController } from '@/lib/use-claims-autorun';
import { creditGate } from '@/lib/claims-autorun-controller';

export type ClaimsAutorunProps = {
  ctl: ClaimsAutorunController;
  onBackEdit: () => void;
};

const RING_RADIUS = 24;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** 费用行：余额一律来自积分状态，没有账户时不伪造数字。 */
function CostLine({ ctl }: { ctl: ClaimsAutorunController }) {
  const { credits, cost } = ctl;

  if (credits.status === 'ready') {
    const after = credits.balance - cost;
    return (
      <p className="text-xs font-bold text-muted">
        将扣 <span className="font-black text-coral">{cost}</span> 积分 · 余额 {credits.balance}
        {after >= 0 ? ` → ${after}` : ' · 余额不足'}
        {credits.source === 'demo' ? ' · 开发演示余额' : ''}
      </p>
    );
  }
  if (credits.status === 'loading') {
    return (
      <p className="text-xs font-bold text-muted">
        将扣 <span className="font-black text-coral">{cost}</span> 积分 · 正在读取积分余额…
      </p>
    );
  }
  return (
    <p className="text-xs font-bold text-muted">
      将扣 <span className="font-black text-coral">{cost}</span> 积分 · 积分账户尚未接入
    </p>
  );
}

/**
 * ⑦b · 疑点 1–2 个 · 30 秒后自动开查。
 * 不弹多疑点选择页：复用 ClaimMarkedText 展示原文与风险标记，底部是费用提示与倒计时。
 * 取消后保留完整原文并回到可编辑状态，同一份预览不再自动倒计时。
 */
export function ClaimsAutorun({ ctl, onBackEdit }: ClaimsAutorunProps) {
  const reduced = useReducedMotion();
  const { snapshot, preview } = ctl;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { phase } = snapshot;

  const claims = useMemo(() => preview?.claims ?? [], [preview]);
  const input = preview?.input ?? '';
  const layout = useMemo(() => buildClaimMarks(input, claims), [input, claims]);
  const allIds = useMemo(() => claims.map((claim) => claim.id), [claims]);

  const waiting = phase === 'pending' || phase === 'counting';
  const editable = phase === 'cancelled-editable' || phase === 'stale';
  const stale = phase === 'stale';
  const starting = phase === 'starting';
  const gate = creditGate(ctl.credits, ctl.cost);
  const insufficient = gate === 'insufficient';

  // 取消 / 进入手动确认后，把焦点交给文本框，方便键盘用户直接修改。
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (wasWaiting.current && phase === 'cancelled-editable') {
      textareaRef.current?.focus({ preventScroll: true });
    }
    wasWaiting.current = waiting;
  }, [phase, waiting]);

  // Esc = 取消（仅限开查前的等待）。
  useEffect(() => {
    if (!waiting) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      ctl.cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ctl, waiting]);

  if (!preview) return null;

  const dashOffset =
    phase === 'counting'
      ? RING_LENGTH * (1 - snapshot.secondsLeft / AUTORUN_SECONDS)
      : 0;
  const ringLabel = phase === 'counting' ? snapshot.secondsLeft : AUTORUN_SECONDS;
  const length = snapshot.text.trim().length;
  const lengthInvalid = length < SCRIPTCHECK_MIN || length > SCRIPTCHECK_MAX;

  return (
    <div className="mx-auto w-full max-w-[860px] px-3 py-6 pb-16">
      {/* 读屏只播报状态转换，不逐秒打断 */}
      <p role="status" aria-live="polite" className="sr-only">
        {ctl.announcement}
      </p>

      <section
        aria-label="报案单 · 疑点较少，准备自动查证"
        className="relative rounded-[26px] border-[3px] border-ink bg-card p-4 shadow-ink-lg sm:p-5"
      >
        <span className="absolute -top-3 right-7 rotate-6 rounded-md border-2 border-ink bg-coral px-2.5 py-0.5 text-xs font-black text-white shadow-ink-sm">
          报案单
        </span>

        <div className="rounded-2xl border-2 border-ink/25 bg-paper p-4">
          {editable ? (
            <>
              <label htmlFor="autorun-text" className="mb-1.5 block text-xs font-black text-ink">
                文案原文（可修改）
              </label>
              <textarea
                id="autorun-text"
                ref={textareaRef}
                value={snapshot.text}
                onChange={(event) => ctl.setText(event.target.value)}
                rows={6}
                className="block w-full resize-y rounded-xl border-2 border-ink bg-card p-3 text-[15px] leading-7 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
              />
              <p
                className={`mt-1 text-right text-[11px] font-bold ${
                  lengthInvalid ? 'text-coral' : 'text-muted'
                }`}
              >
                {length} 字 · 支持 {SCRIPTCHECK_MIN}–{SCRIPTCHECK_MAX} 字
              </p>

              <div className="mt-3 rounded-xl border-2 border-dashed border-ink/25 bg-card p-3">
                <p className="mb-1.5 text-[11px] font-black text-muted">
                  {stale
                    ? '以下是上一次免费体检的结果，仅供参考；文案已改，不能用于查证'
                    : '免费体检结果（只读）· 虚线框 = AI 初判 · 待查证'}
                </p>
                <ClaimMarkedText
                  input={input}
                  claims={claims}
                  layout={layout}
                  selectedIds={stale ? [] : allIds}
                  dimmed={stale}
                  unlocatedNote="疑点仍会一并送检。"
                />
              </div>
            </>
          ) : (
            <>
              <ClaimMarkedText
                input={input}
                claims={claims}
                layout={layout}
                selectedIds={allIds}
                unlocatedNote="疑点仍会一并送检。"
              />
              <p className="mt-3 text-[11px] font-bold text-muted">
                <span aria-hidden>✅ </span>找到 {ctl.claimCount} 个疑点（免费）· 虚线框 = AI 初判 ·
                待查证
              </p>
            </>
          )}
        </div>

        {/* 底部：倒计时 / 取消后的提示 / 过期提示 */}
        <div
          className={`mt-4 rounded-2xl border-[3px] border-ink p-3 shadow-ink-sm sm:p-4 ${
            stale || phase === 'error' ? 'bg-coral-soft' : 'bg-beige'
          }`}
        >
          {waiting || starting ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative h-14 w-14 shrink-0" aria-hidden>
                <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
                  <circle
                    cx="28"
                    cy="28"
                    r={RING_RADIUS}
                    fill="var(--color-card)"
                    stroke="var(--color-paper-deep)"
                    strokeWidth="5"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r={RING_RADIUS}
                    fill="none"
                    stroke="var(--color-brand)"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={RING_LENGTH}
                    strokeDashoffset={starting ? 0 : dashOffset}
                    className={reduced ? '' : 'transition-[stroke-dashoffset] duration-1000 ease-linear'}
                  />
                </svg>
                <span className="absolute inset-0 grid place-items-center text-lg font-black text-ink">
                  {starting ? '…' : ringLabel}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                {starting ? (
                  <>
                    <p className="text-base font-black text-ink">正在开始查证…</p>
                    <CostLine ctl={ctl} />
                  </>
                ) : (
                  <>
                    <p className="text-base font-black text-ink">
                      发现 {ctl.claimCount} 个疑点，{AUTORUN_SECONDS} 秒后开始查证
                    </p>
                    <CostLine ctl={ctl} />
                    <p className="mt-0.5 text-[11px] font-bold text-muted">
                      AI 初判 · 待查证
                      {snapshot.pendingReason === 'hidden'
                        ? ` · 页面在后台，已暂停；回到前台后重新给你完整 ${AUTORUN_SECONDS} 秒`
                        : snapshot.pendingReason === 'credits-loading'
                          ? ' · 正在读取积分余额，读取完成后才开始倒计时'
                          : snapshot.resumedAfterHidden
                            ? ` · 已重新开始完整 ${AUTORUN_SECONDS} 秒`
                            : ' · 倒计时中不扣积分，随时可取消'}
                    </p>
                  </>
                )}
              </div>

              {!starting ? (
                <div className="flex shrink-0 items-center gap-2">
                  <ComicButton variant="white" size="sm" onClick={ctl.cancel}>
                    取消
                  </ComicButton>
                  <ComicButton variant="brand" size="sm" onClick={ctl.startNow}>
                    立即开始 <span aria-hidden>▶</span>
                  </ComicButton>
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === 'cancelled-editable' ? (
            <div className="flex flex-wrap items-center gap-3">
              <DetectiveMascot className="h-12 w-12 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                {snapshot.manualReason === 'cancelled' ? (
                  <p className="text-sm leading-6 font-black text-ink">
                    已取消自动查证，本次未扣积分。
                    <br />
                    你可以修改文案，或手动开始查证。
                  </p>
                ) : snapshot.manualReason === 'restored' ? (
                  <p className="text-sm leading-6 font-black text-ink">
                    这份文案已经出现过自动查证，为避免重复扣积分，不会再自动倒计时。
                    <br />
                    你可以修改文案，或手动开始查证。
                  </p>
                ) : snapshot.manualReason === 'no-account' ? (
                  <p className="text-sm leading-6 font-black text-ink">
                    积分账户尚未接入，不会自动开查，也不会扣积分。
                    <br />
                    确认后可手动开始查证。
                  </p>
                ) : (
                  <p className="text-sm leading-6 font-black text-coral">
                    积分不足，不会开查，也未扣积分。
                  </p>
                )}
                <CostLine ctl={ctl} />
              </div>
              <ComicButton
                variant="brand"
                size="sm"
                onClick={ctl.startManual}
                disabled={insufficient || gate === 'loading'}
              >
                开始查证 · 预计 {ctl.cost} 积分
              </ComicButton>
            </div>
          ) : null}

          {stale ? (
            <div className="flex flex-wrap items-center gap-3">
              <DetectiveMascot className="h-12 w-12 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-6 font-black text-coral">
                  文案已修改，需重新体检。
                </p>
                <p className="text-[11px] font-bold text-muted">
                  旧体检结果对应旧版本，不能用于查证。重新免费体检不扣积分，完成后才会按新结果分流。
                </p>
                {ctl.recheckError ? (
                  <p role="alert" className="mt-1 text-[11px] font-black text-coral">
                    {ctl.recheckError}
                  </p>
                ) : null}
              </div>
              <ComicButton variant="brand" size="sm" onClick={ctl.recheck}>
                重新免费体检
              </ComicButton>
            </div>
          ) : null}

          {phase === 'error' ? (
            <div className="flex flex-wrap items-center gap-3">
              <DetectiveMascot className="h-12 w-12 shrink-0" mood="yawn" aria-hidden />
              <div className="min-w-0 flex-1">
                <p role="alert" className="text-sm leading-6 font-black text-coral">
                  {snapshot.errorMessage ?? '没能开始查证，本次未扣积分。'}
                </p>
                <CostLine ctl={ctl} />
              </div>
              <ComicButton variant="brand" size="sm" onClick={ctl.retryStart}>
                手动重试
              </ComicButton>
            </div>
          ) : null}
        </div>

        {editable ? (
          <div className="mt-3 text-right">
            <button
              type="button"
              onClick={onBackEdit}
              className="text-[11px] font-black text-muted underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
            >
              返回首页编辑
            </button>
          </div>
        ) : null}
      </section>

    </div>
  );
}

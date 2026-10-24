'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import { ComicButton } from '@/components/ui/comic-button';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { claimKindLabel, RISK_META } from '@/lib/labels';
import type { Claim } from '@/types/case';

export type ClaimReviewDialogProps = {
  open: boolean;
  /** 正在识别截图 / 拆解疑点。 */
  loading: boolean;
  /** 压缩后的截图，用于核对是不是传对了图。 */
  image?: string;
  /** 视觉模型转写出的原文（可能带画面线索）。 */
  input?: string;
  claims: Claim[];
  selectedIds: string[];
  pricePerClaim?: number;
  onToggle: (claimId: string) => void;
  onToggleAll: () => void;
  onConfirm: () => void;
  onSwitchToText: () => void;
  onRetryUpload: () => void;
};

/**
 * 图片立案第 1 步：先核对视觉模型读出的主张 / 人物 / 时间 / 数据 / 可疑点，
 * 用户勾选后才把选中的疑点送去深查。
 */
export function ClaimReviewDialog({
  open,
  loading,
  image,
  input,
  claims,
  selectedIds,
  pricePerClaim,
  onToggle,
  onToggleAll,
  onConfirm,
  onSwitchToText,
  onRetryUpload,
}: ClaimReviewDialogProps) {
  const reduced = useReducedMotion();
  const empty = !loading && claims.length === 0;
  const allSelected = claims.length > 0 && selectedIds.length === claims.length;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onSwitchToText();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSwitchToText, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.12 : 0.2 }}
        >
          <div aria-hidden className="absolute inset-0 bg-scrim" />

          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-review-title"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={
              reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 300, damping: 28 }
            }
            className="relative flex max-h-[84vh] w-[560px] max-w-[calc(100vw-32px)] flex-col rounded-[24px] border-[3px] border-ink bg-card shadow-ink-lg"
          >
            <header className="flex shrink-0 items-start gap-3 border-b-2 border-ink/15 px-6 pt-5 pb-4">
              <DetectiveMascot className="w-[56px] shrink-0 -rotate-3" />
              <div className="min-w-0">
                <p className="text-xs font-black tracking-wide text-muted">图片立案 · 第 1 步</p>
                <h2
                  id="claim-review-title"
                  className="mt-0.5 text-xl leading-snug font-black text-ink"
                >
                  核对截图里的可疑点
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted">
                  先确认 AI 读对了，再勾选要深查的部分；没勾的不花钱。
                </p>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {image ? (
                <div className="mb-3 flex items-start gap-3 rounded-xl border-2 border-ink/20 bg-paper p-2">
                  <img
                    src={image}
                    alt="待查证截图"
                    className="h-16 w-16 shrink-0 rounded-lg border-2 border-ink object-cover"
                  />
                  {input ? (
                    <details className="min-w-0 flex-1">
                      <summary className="cursor-pointer text-xs font-black text-ink">
                        AI 读到的原文（展开核对）
                      </summary>
                      <p className="mt-1 max-h-24 overflow-y-auto text-xs leading-5 whitespace-pre-wrap text-muted">
                        {input}
                      </p>
                    </details>
                  ) : null}
                </div>
              ) : null}

              {loading ? (
                <div className="flex flex-col items-center gap-2 py-10" role="status">
                  <span aria-hidden className="animate-bounce text-2xl">
                    🔍
                  </span>
                  <p className="text-sm font-black text-ink">正在识别截图并拆解疑点…</p>
                  <p className="text-xs text-muted">识别文字、人物、时间和数据，通常需要十几秒</p>
                </div>
              ) : null}

              {empty ? (
                <div className="rounded-xl border-2 border-dashed border-ink/30 bg-paper px-4 py-8 text-center">
                  <p className="text-sm font-black text-ink">没从截图里拆出可查证的疑点</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    可能字太少或太糊。换一张更清晰的截图，或直接把文字粘贴过来。
                  </p>
                </div>
              ) : null}

              {!loading && claims.length > 0 ? (
                <ul className="space-y-2.5">
                  {claims.map((claim) => {
                    const checked = selectedIds.includes(claim.id);
                    const risk = claim.riskLevel ? RISK_META[claim.riskLevel] : null;
                    const signals = claim.signals ?? [];

                    return (
                      <li key={claim.id}>
                        <label
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors ${
                            checked
                              ? 'border-brand bg-brand-soft'
                              : 'border-ink/20 bg-card hover:border-ink/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggle(claim.id)}
                            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded border border-ink/30 bg-card px-1.5 py-px text-[10px] font-black text-ink">
                                {claimKindLabel(claim.kind)}
                              </span>
                              {risk ? (
                                <span
                                  className={`rounded border px-1.5 py-px text-[10px] font-black ${risk.bg} ${risk.text} ${risk.border}`}
                                >
                                  {risk.label}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm leading-5 font-bold text-ink">
                              {claim.text}
                            </p>
                            {claim.sentence ? (
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                                <span className="font-black">原文：</span>
                                {claim.sentence}
                              </p>
                            ) : null}
                            {signals.length > 0 ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                <span className="text-[10px] font-black text-coral">可疑点</span>
                                {signals.map((signal) => (
                                  <span
                                    key={signal}
                                    className="rounded-full border border-coral/40 bg-coral-soft px-1.5 py-px text-[10px] font-black text-coral"
                                  >
                                    {signal}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {claim.consequence ? (
                              <p className="mt-1 text-[11px] leading-4 text-muted">
                                {claim.consequence}
                              </p>
                            ) : null}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>

            <footer className="shrink-0 border-t-2 border-ink/15 px-6 py-4">
              <div className="mb-2.5 flex items-center justify-between text-xs font-black text-muted">
                <button
                  type="button"
                  onClick={onToggleAll}
                  disabled={loading || claims.length === 0}
                  className="underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {allSelected ? '清空选择' : '全选'}
                </button>
                <span>
                  已选 {selectedIds.length} / {claims.length} 个
                  {pricePerClaim ? ` · 每个 ¥${pricePerClaim}` : ''}
                </span>
              </div>

              <div className="grid gap-2">
                <ComicButton
                  variant="brand"
                  onClick={onConfirm}
                  disabled={loading || empty || selectedIds.length === 0}
                  className="w-full"
                >
                  {empty ? '没有可深查的疑点' : `🔎 确认并深查（${selectedIds.length} 个）`}
                </ComicButton>
                <div className="grid grid-cols-2 gap-2">
                  <ComicButton variant="white" size="sm" onClick={onSwitchToText}>
                    📝 改为粘贴文字
                  </ComicButton>
                  <ComicButton variant="white" size="sm" onClick={onRetryUpload}>
                    🖼️ 重新传截图
                  </ComicButton>
                </div>
              </div>
            </footer>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

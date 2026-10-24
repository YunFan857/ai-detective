'use client';

import { useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ComicButton } from '@/components/ui/comic-button';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { MAX_SELECTED_CLAIMS } from '@/lib/claims-intake';
import { countByRisk, sortClaimsForPick } from '@/lib/claims-selection';
import { buildClaimMarks, type ClaimMark } from '@/lib/claims-span';
import { claimCategoryLabel, RISK_META } from '@/lib/labels';
import type { ClaimsPreview } from '@/types/case';

export type ClaimsPickProps = {
  preview: ClaimsPreview;
  selectedIds: string[];
  notice: string | null;
  confirming: boolean;
  atLimit: boolean;
  onToggle: (claimId: string) => void;
  onToggleMany: (claimIds: string[]) => void;
  onSelectHigh: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onConfirm: () => void;
  onBackEdit: () => void;
};

type TextPiece =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'mark'; key: string; mark: ClaimMark };

const RISK_ORDER = ['high', 'medium', 'low'] as const;

/**
 * ⑦ 原文风险框 + 勾选疑点。
 * 左侧与右侧共享 selectedIds；所有风险都明确标注为 AI 初判，不提前下查证结论。
 */
export function ClaimsPick({
  preview,
  selectedIds,
  notice,
  confirming,
  atLimit,
  onToggle,
  onToggleMany,
  onSelectHigh,
  onSelectAll,
  onClear,
  onConfirm,
  onBackEdit,
}: ClaimsPickProps) {
  const reduced = useReducedMotion();
  const claims = preview.claims;
  const claimsById = useMemo(() => new Map(claims.map((claim) => [claim.id, claim])), [claims]);
  const sorted = useMemo(() => sortClaimsForPick(claims), [claims]);
  const layout = useMemo(
    () => buildClaimMarks(preview.input, claims),
    [preview.input, claims],
  );
  const counts = useMemo(() => countByRisk(claims), [claims]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const markRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const activeClaim =
    (activeId ? claimsById.get(activeId) : undefined) ?? sorted[0]?.claim ?? null;

  const pieces = useMemo<TextPiece[]>(() => {
    const list: TextPiece[] = [];
    let cursor = 0;
    layout.marks.forEach((mark, index) => {
      if (mark.start > cursor) {
        list.push({
          kind: 'text',
          key: `text-${index}-${cursor}`,
          text: preview.input.slice(cursor, mark.start),
        });
      }
      list.push({ kind: 'mark', key: mark.key, mark });
      cursor = mark.end;
    });
    if (cursor < preview.input.length) {
      list.push({ kind: 'text', key: 'text-tail', text: preview.input.slice(cursor) });
    }
    return list;
  }, [layout.marks, preview.input]);

  const totalPrice = preview.pricePerClaim * selectedIds.length;
  const selectedCount = selectedIds.length;

  function scrollTo(element: HTMLElement | null): void {
    if (!element) return;
    element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }

  function locateMark(claimId: string): void {
    const index = layout.markIndexByClaim[claimId];
    const mark = index === undefined ? undefined : layout.marks[index];
    if (!mark) return;
    setActiveId(claimId);
    const element = markRefs.current[mark.key];
    scrollTo(element);
    element?.focus({ preventScroll: true });
  }

  function locateCard(claimId: string): void {
    setActiveId(claimId);
    const element = cardRefs.current[claimId];
    scrollTo(element);
    element?.focus({ preventScroll: true });
  }

  function handleMarkClick(mark: ClaimMark): void {
    setActiveId(mark.claimIds[0] ?? null);
    onToggleMany(mark.claimIds);
  }

  return (
    <>
      <div className="mx-auto grid w-full max-w-[1440px] gap-3 px-3 py-3 pb-44 lg:grid-cols-[minmax(0,1.35fr)_minmax(400px,1fr)] lg:pb-36">
        <section
          aria-label="原文风险标记"
          className="comic-card flex min-h-[560px] flex-col overflow-hidden"
        >
          <header className="shrink-0 border-b-2 border-ink/15 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="flex items-center gap-1.5 text-base font-black text-ink">
                <span aria-hidden>📄</span>
                原文 · 发现 {claims.length} 个疑点
              </h1>
              <span className="ml-auto text-[11px] font-bold text-muted">
                点框框 = 勾选 / 取消
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-black text-muted">
              {RISK_ORDER.map((risk) => (
                <span key={risk} className="flex items-center gap-1">
                  <i className={`h-2.5 w-2.5 rounded-full ${RISK_META[risk].dot}`} aria-hidden />
                  {RISK_META[risk].label}
                </span>
              ))}
              <span className="flex items-center gap-1">
                <i
                  className="h-2.5 w-2.5 rounded-full border border-dashed border-gray/70"
                  aria-hidden
                />
                未勾选
              </span>
              <span className="text-muted/80">虚线框 = AI 初判 · 待查证，查完才会变成结论</span>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="text-[15px] leading-8 break-words whitespace-pre-wrap text-ink">
              {pieces.map((piece) => {
                if (piece.kind === 'text') return <span key={piece.key}>{piece.text}</span>;

                const mark = piece.mark;
                const related = mark.claimIds
                  .map((id) => claimsById.get(id))
                  .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim));
                const highest = related.reduce<(typeof related)[number] | undefined>(
                  (current, claim) => {
                    const rank = (value: string | undefined): number =>
                      value === 'high' ? 0 : value === 'medium' ? 1 : 2;
                    if (!current) return claim;
                    return rank(claim.riskLevel) < rank(current.riskLevel) ? claim : current;
                  },
                  undefined,
                );
                const risk = RISK_META[highest?.riskLevel ?? 'low'];
                const selectedFlags = mark.claimIds.map((id) => selectedIds.includes(id));
                const allSelected = selectedFlags.every(Boolean);
                const someSelected = selectedFlags.some(Boolean);
                const isActive = mark.claimIds.includes(activeId ?? '');

                return (
                  <span
                    key={piece.key}
                    ref={(element) => {
                      markRefs.current[mark.key] = element;
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={allSelected}
                    aria-label={`${related.map((claim) => claim.text).join('；')}。${risk.label}。AI 初判，待查证。${
                      allSelected ? '点击取消勾选' : '点击勾选'
                    }`}
                    onClick={() => handleMarkClick(mark)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      handleMarkClick(mark);
                    }}
                    onMouseEnter={() => setActiveId(mark.claimIds[0] ?? null)}
                    onFocus={() => setActiveId(mark.claimIds[0] ?? null)}
                    className={`mx-0.5 inline cursor-pointer rounded-md px-0.5 py-px align-baseline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark ${
                      allSelected
                        ? `border-2 border-dashed ${risk.border} ${risk.bg} ${risk.text}`
                        : someSelected
                          ? 'border-2 border-dashed border-ink/40 bg-gray-soft/70 text-ink'
                          : 'border border-dashed border-gray/60 bg-transparent text-ink hover:border-ink/50'
                    } ${isActive ? 'ring-2 ring-brand-dark/50 ring-offset-1' : ''}`}
                  >
                    {preview.input.slice(mark.start, mark.end)}
                  </span>
                );
              })}
            </p>

            {layout.unlocatedClaims.length > 0 ? (
              <p className="mt-3 rounded-lg border-2 border-dashed border-ink/20 bg-paper px-2.5 py-1.5 text-[11px] leading-4 font-bold text-muted">
                {layout.unlocatedClaims.length} 个疑点暂无法定位原文，已在右侧保留卡片。
              </p>
            ) : null}
          </div>

          {activeClaim ? (
            <motion.aside
              key={activeClaim.id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0.12 : 0.2 }}
              aria-label="当前疑点详情"
              className="max-h-[240px] shrink-0 overflow-y-auto border-t-2 border-ink/15 bg-paper px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded border-2 border-dashed px-1.5 py-px text-[10px] font-black ${
                    RISK_META[activeClaim.riskLevel ?? 'low'].bg
                  } ${RISK_META[activeClaim.riskLevel ?? 'low'].text} ${
                    RISK_META[activeClaim.riskLevel ?? 'low'].border
                  }`}
                >
                  {RISK_META[activeClaim.riskLevel ?? 'low'].label}
                </span>
                {activeClaim.category ? (
                  <span className="rounded border border-ink/25 bg-card px-1.5 py-px text-[10px] font-black text-ink">
                    {claimCategoryLabel(activeClaim.category)}
                  </span>
                ) : null}
                <span className="text-[10px] font-black text-muted">AI 初判 · 待查证</span>
                <button
                  type="button"
                  onClick={() => locateCard(activeClaim.id)}
                  className="ml-auto rounded-full border border-ink/30 bg-card px-2 py-0.5 text-[10px] font-black text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
                >
                  定位卡片
                </button>
              </div>

              <p className="mt-1.5 text-sm leading-5 font-black text-ink">{activeClaim.text}</p>

              {(activeClaim.signals ?? []).length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] font-black text-coral">可疑点</span>
                  {(activeClaim.signals ?? []).map((signal) => (
                    <span
                      key={signal}
                      className="rounded-full border border-coral/40 bg-coral-soft px-1.5 py-px text-[10px] font-black text-coral"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              ) : null}

              {activeClaim.consequence ? (
                <p className="mt-1 text-[11px] leading-4 font-bold text-muted">
                  ⚠️ {activeClaim.consequence}
                </p>
              ) : null}
            </motion.aside>
          ) : null}
        </section>

        <section
          aria-label="疑点清单"
          className="comic-card flex min-h-[560px] flex-col overflow-hidden"
        >
          <header className="flex shrink-0 items-center gap-2 border-b-2 border-ink/15 px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-base font-black text-ink">
              <span aria-hidden>🗂</span>
              疑点清单
            </h2>
            <span className="ml-auto text-[11px] font-bold text-muted">按风险从高到低</span>
          </header>

          <div className="shrink-0 border-b-2 border-ink/15 px-3 py-3">
            <div className="grid grid-cols-3 gap-2">
              {RISK_ORDER.map((risk) => {
                const meta = RISK_META[risk];
                return (
                  <div
                    key={risk}
                    className={`rounded-xl border-2 border-dashed px-2 py-2 text-center ${meta.bg} ${meta.border}`}
                  >
                    <p className={`text-2xl leading-none font-black ${meta.text}`}>
                      {counts[risk]}
                    </p>
                    <p className={`mt-1 text-[11px] font-black ${meta.text}`}>{meta.label}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onSelectHigh}
                className="rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[11px] font-black text-ink transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
              >
                只选高风险
              </button>
              <button
                type="button"
                onClick={onSelectAll}
                className="rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[11px] font-black text-ink transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
              >
                全选
              </button>
              <button
                type="button"
                onClick={onClear}
                className="rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[11px] font-black text-ink transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
              >
                清空
              </button>
              <span className="ml-auto text-[10px] font-bold text-muted">
                一次最多 {MAX_SELECTED_CLAIMS} 个
              </span>
            </div>

            <p
              role="status"
              aria-live="polite"
              className={`mt-1.5 text-[11px] leading-4 font-bold ${
                notice ? 'text-coral' : 'text-muted'
              }`}
            >
              {notice ??
                `已选 ${selectedCount} / ${claims.length} 个；默认只勾选高风险，最多 ${MAX_SELECTED_CLAIMS} 个。`}
            </p>

            {preview.autoRun ? (
              <p className="mt-1 text-[10px] font-bold text-muted">
                本次疑点较少，确认后手动开始，不会自动开查或自动扣费。
              </p>
            ) : null}
          </div>

          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {sorted.map(({ claim }) => {
              const risk = RISK_META[claim.riskLevel ?? 'low'];
              const checked = selectedIds.includes(claim.id);
              const canLocate = layout.markIndexByClaim[claim.id] !== undefined;
              const inputId = `claim-check-${claim.id}`;
              const isActive = activeClaim?.id === claim.id;

              return (
                <li
                  key={claim.id}
                  ref={(element) => {
                    cardRefs.current[claim.id] = element;
                  }}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveId(claim.id)}
                  onFocusCapture={() => setActiveId(claim.id)}
                  onMouseLeave={() => undefined}
                  className={`rounded-xl border-2 p-3 transition-[border-color,background-color,box-shadow] ${
                    checked
                      ? `${risk.border} ${risk.bg}`
                      : 'border-ink/15 bg-card hover:border-ink/30'
                  } ${isActive ? 'ring-2 ring-brand-dark/45 ring-offset-1' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && atLimit}
                      onChange={() => onToggle(claim.id)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                    />

                    <div className="min-w-0 flex-1">
                      <label htmlFor={inputId} className="block cursor-pointer select-none">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded border-2 border-dashed px-1.5 py-px text-[10px] font-black ${risk.bg} ${risk.text} ${risk.border}`}
                          >
                            {risk.label}
                          </span>
                          {claim.category ? (
                            <span className="rounded border border-ink/25 bg-card px-1.5 py-px text-[10px] font-black text-ink">
                              {claimCategoryLabel(claim.category)}
                            </span>
                          ) : null}
                          <span className="ml-auto rounded-full border border-ink/25 bg-card px-1.5 py-px text-[10px] font-black text-muted">
                            {preview.pricePerClaim} 积分
                          </span>
                        </div>

                        <p className="mt-1 text-sm leading-5 font-black text-ink">{claim.text}</p>

                        {claim.sentence && claim.sentence !== claim.text ? (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 font-bold text-muted">
                            原文：{claim.sentence}
                          </p>
                        ) : null}

                        {(claim.signals ?? []).length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {(claim.signals ?? []).map((signal) => (
                              <span
                                key={signal}
                                className="rounded-full border border-ink/25 bg-card px-1.5 py-px text-[10px] font-black text-ink"
                              >
                                {signal}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {claim.consequence ? (
                          <p className="mt-1 text-[11px] leading-4 font-bold text-muted">
                            ⚠️ {claim.consequence}
                          </p>
                        ) : null}

                        <p className="mt-1 text-[10px] font-black text-muted">
                          AI 初判 · 待查证
                        </p>
                      </label>

                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold text-muted">
                          {checked
                            ? '已勾选'
                            : atLimit
                              ? `已达 ${MAX_SELECTED_CLAIMS} 个上限`
                              : '未勾选'}
                        </span>
                        {canLocate ? (
                          <button
                            type="button"
                            onClick={() => locateMark(claim.id)}
                            className="ml-auto rounded-full border border-ink/30 bg-card px-2 py-0.5 text-[10px] font-black text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
                          >
                            ↩ 定位原文
                          </button>
                        ) : (
                          <span className="ml-auto text-[10px] font-bold text-muted">
                            暂无法定位原文
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-ink bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-2 px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-ink bg-brand-soft">
            <DetectiveMascot className="h-10 w-10 -translate-y-1" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black text-ink">
              已选 {selectedCount} 个 · 将扣 {totalPrice} 积分
            </p>
            <p className="text-[10px] leading-4 font-bold text-muted">
              单价 {preview.pricePerClaim} 积分 / 个 · 演示模式 · 暂未启用积分账户，未真实扣款
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ComicButton variant="white" size="sm" onClick={onBackEdit}>
              返回编辑
            </ComicButton>
            <ComicButton
              variant="brand"
              onClick={onConfirm}
              disabled={selectedCount === 0 || confirming}
              aria-busy={confirming}
            >
              {confirming ? '正在立案…' : '🕵️ 开始查证'}
            </ComicButton>
          </div>
        </div>
        {selectedCount === 0 ? (
          <p className="mx-auto w-full max-w-[1440px] px-4 pb-2 text-[10px] font-bold text-coral">
            至少勾选 1 个疑点才能开始；清空后不会自动扣费。
          </p>
        ) : null}
      </div>
    </>
  );
}

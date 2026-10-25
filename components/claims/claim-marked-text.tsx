'use client';

import { useMemo } from 'react';
import type { ClaimSpanLayout } from '@/lib/claims-span';
import { RISK_META } from '@/lib/labels';
import type { Claim } from '@/types/case';

export type ClaimMarkedTextProps = {
  input: string;
  claims: Claim[];
  layout: ClaimSpanLayout;
  selectedIds: string[];
  activeId?: string | null;
  /** 不传 = 只读展示（⑦b）；传入后每个标记是可勾选的按钮（⑦）。 */
  onToggleMarks?: (claimIds: string[]) => void;
  onActiveChange?: (claimId: string | null) => void;
  registerMark?: (key: string, element: HTMLSpanElement | null) => void;
  /** 文案已改动、结果仅供参考时压暗。 */
  dimmed?: boolean;
  /** 无法定位原文的疑点提示后缀，⑦ 与 ⑦b 的落点不同。 */
  unlocatedNote?: string;
};

type TextPiece =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'mark'; key: string; mark: ClaimSpanLayout['marks'][number] };

function riskRank(value: string | undefined): number {
  return value === 'high' ? 0 : value === 'medium' ? 1 : 2;
}

/**
 * 原文 + 风险虚线框。⑦ 勾选页与 ⑦b 自动开查页共用同一套 span 渲染，
 * 标记位置完全来自经过校验的 layout（UTF-16 下标，且必须与 sentence 一致）。
 */
export function ClaimMarkedText({
  input,
  claims,
  layout,
  selectedIds,
  activeId = null,
  onToggleMarks,
  onActiveChange,
  registerMark,
  dimmed = false,
  unlocatedNote = '已在右侧保留卡片。',
}: ClaimMarkedTextProps) {
  const claimsById = useMemo(() => new Map(claims.map((claim) => [claim.id, claim])), [claims]);
  const interactive = Boolean(onToggleMarks);

  const pieces = useMemo<TextPiece[]>(() => {
    const list: TextPiece[] = [];
    let cursor = 0;
    layout.marks.forEach((mark, index) => {
      if (mark.start > cursor) {
        list.push({
          kind: 'text',
          key: `text-${index}-${cursor}`,
          text: input.slice(cursor, mark.start),
        });
      }
      list.push({ kind: 'mark', key: mark.key, mark });
      cursor = mark.end;
    });
    if (cursor < input.length) {
      list.push({ kind: 'text', key: 'text-tail', text: input.slice(cursor) });
    }
    return list;
  }, [input, layout.marks]);

  return (
    <>
      <p
        className={`text-[15px] leading-8 break-words whitespace-pre-wrap text-ink ${
          dimmed ? 'opacity-60' : ''
        }`}
      >
        {pieces.map((piece) => {
          if (piece.kind === 'text') return <span key={piece.key}>{piece.text}</span>;

          const mark = piece.mark;
          const related = mark.claimIds
            .map((id) => claimsById.get(id))
            .filter((claim): claim is Claim => Boolean(claim));
          const highest = related.reduce<Claim | undefined>((current, claim) => {
            if (!current) return claim;
            return riskRank(claim.riskLevel) < riskRank(current.riskLevel) ? claim : current;
          }, undefined);
          const risk = RISK_META[highest?.riskLevel ?? 'low'];
          const selectedFlags = mark.claimIds.map((id) => selectedIds.includes(id));
          const allSelected = selectedFlags.every(Boolean);
          const someSelected = selectedFlags.some(Boolean);
          const isActive = mark.claimIds.includes(activeId ?? '');
          const names = related.map((claim) => claim.text).join('；');

          return (
            <span
              key={piece.key}
              ref={
                registerMark
                  ? (element) => {
                      registerMark(mark.key, element);
                    }
                  : undefined
              }
              role={interactive ? 'button' : 'group'}
              tabIndex={0}
              aria-pressed={interactive ? allSelected : undefined}
              aria-label={
                interactive
                  ? `${names}。${risk.label}。AI 初判，待查证。${
                      allSelected ? '点击取消勾选' : '点击勾选'
                    }`
                  : `${names}。${risk.label}。AI 初判，待查证。`
              }
              onClick={
                interactive
                  ? () => {
                      onActiveChange?.(mark.claimIds[0] ?? null);
                      onToggleMarks?.(mark.claimIds);
                    }
                  : undefined
              }
              onKeyDown={
                interactive
                  ? (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onActiveChange?.(mark.claimIds[0] ?? null);
                      onToggleMarks?.(mark.claimIds);
                    }
                  : undefined
              }
              onMouseEnter={onActiveChange ? () => onActiveChange(mark.claimIds[0] ?? null) : undefined}
              onFocus={onActiveChange ? () => onActiveChange(mark.claimIds[0] ?? null) : undefined}
              className={`mx-0.5 inline rounded-md px-0.5 py-px align-baseline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark ${
                interactive ? 'cursor-pointer' : 'cursor-default'
              } ${
                allSelected
                  ? `border-2 border-dashed ${risk.border} ${risk.bg} ${risk.text}`
                  : someSelected
                    ? 'border-2 border-dashed border-ink/40 bg-gray-soft/70 text-ink'
                    : 'border border-dashed border-gray/60 bg-transparent text-ink hover:border-ink/50'
              } ${isActive ? 'ring-2 ring-brand-dark/50 ring-offset-1' : ''}`}
            >
              {input.slice(mark.start, mark.end)}
            </span>
          );
        })}
      </p>

      {layout.unlocatedClaims.length > 0 ? (
        <p className="mt-3 rounded-lg border-2 border-dashed border-ink/20 bg-paper px-2.5 py-1.5 text-[11px] leading-4 font-bold text-muted">
          {layout.unlocatedClaims.length} 个疑点暂无法定位原文，{unlocatedNote}
        </p>
      ) : null}
    </>
  );
}

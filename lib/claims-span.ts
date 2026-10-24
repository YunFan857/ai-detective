import type { Claim } from '@/types/case';

/**
 * 原文风险框的定位结果。
 * span 是 UTF-16 下标，end 不包含在内；只有范围合法且与 sentence 完全一致才允许标记。
 */
export type ClaimMark = {
  key: string;
  start: number;
  end: number;
  /** 重叠范围合并后，同一处原文可能关联多个疑点。 */
  claimIds: string[];
};

export type ClaimSpanLayout = {
  marks: ClaimMark[];
  /** claimId → marks 下标，便于从卡片定位到原文。 */
  markIndexByClaim: Record<string, number>;
  locatedClaimIds: string[];
  unlocatedClaims: Claim[];
};

function isValidSpan(input: string, claim: Claim): boolean {
  const { span, sentence } = claim;
  if (!span || typeof sentence !== 'string' || sentence.length === 0) return false;
  const { start, end } = span;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end <= start || end > input.length) return false;
  // 不信任模型给的下标：必须与它声明的原句逐字一致。
  return input.slice(start, end) === sentence;
}

/** 校验 span、合并重叠范围；无法定位的疑点单独返回，仍保留卡片。 */
export function buildClaimMarks(input: string, claims: Claim[]): ClaimSpanLayout {
  const located: { claim: Claim; start: number; end: number }[] = [];
  const unlocatedClaims: Claim[] = [];

  for (const claim of claims) {
    if (isValidSpan(input, claim) && claim.span) {
      located.push({ claim, start: claim.span.start, end: claim.span.end });
    } else {
      unlocatedClaims.push(claim);
    }
  }

  located.sort((left, right) => left.start - right.start || left.end - right.end);

  const marks: ClaimMark[] = [];
  for (const item of located) {
    const last = marks[marks.length - 1];
    if (last && item.start < last.end) {
      last.end = Math.max(last.end, item.end);
      if (!last.claimIds.includes(item.claim.id)) last.claimIds.push(item.claim.id);
    } else {
      marks.push({
        key: `mark-${item.start}-${item.end}`,
        start: item.start,
        end: item.end,
        claimIds: [item.claim.id],
      });
    }
  }

  const markIndexByClaim: Record<string, number> = {};
  marks.forEach((mark, index) => {
    for (const claimId of mark.claimIds) {
      markIndexByClaim[claimId] = index;
    }
  });

  return {
    marks,
    markIndexByClaim,
    locatedClaimIds: located.map((item) => item.claim.id),
    unlocatedClaims,
  };
}

import { MAX_SELECTED_CLAIMS } from '@/lib/claims-intake';
import type { Claim, RiskLevel } from '@/types/case';

/** 卡片与默认勾选都按「高 → 中 → 低，同级按原文位置」排序。 */
const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

export type SortedClaim = {
  claim: Claim;
  /** 原文中的位置；无法定位时排在同级末尾。 */
  offset: number;
};

export type ToggleResult = {
  ids: string[];
  /** 已达到 10 个上限，本次新增被拒绝。 */
  blocked: boolean;
};

function riskOf(claim: Claim): RiskLevel {
  return claim.riskLevel ?? 'low';
}

export function sortClaimsForPick(claims: Claim[]): SortedClaim[] {
  return claims
    .map((claim, index) => ({
      claim,
      offset: claim.span?.start ?? Number.MAX_SAFE_INTEGER + index,
    }))
    .sort((left, right) => {
      const byRisk = RISK_ORDER[riskOf(left.claim)] - RISK_ORDER[riskOf(right.claim)];
      if (byRisk !== 0) return byRisk;
      return left.offset - right.offset;
    });
}

/** 默认只替用户勾选高风险；没有高风险就保持空选。最多 10 个。 */
export function defaultSelectedClaimIds(claims: Claim[]): string[] {
  return sortClaimsForPick(claims)
    .filter((item) => riskOf(item.claim) === 'high')
    .slice(0, MAX_SELECTED_CLAIMS)
    .map((item) => item.claim.id);
}

export function highRiskClaimIds(claims: Claim[]): string[] {
  return defaultSelectedClaimIds(claims);
}

export function countHighRisk(claims: Claim[]): number {
  return claims.filter((claim) => riskOf(claim) === 'high').length;
}

/** 全选按风险排序后取前 10 个，并告诉界面是否发生截断。 */
export function selectAllUpToLimit(claims: Claim[]): { ids: string[]; capped: boolean } {
  const sorted = sortClaimsForPick(claims).map((item) => item.claim.id);
  return {
    ids: sorted.slice(0, MAX_SELECTED_CLAIMS),
    capped: sorted.length > MAX_SELECTED_CLAIMS,
  };
}

export function toggleClaimId(
  selectedIds: string[],
  claimId: string,
  claims: Claim[],
): ToggleResult {
  if (selectedIds.includes(claimId)) {
    return { ids: selectedIds.filter((id) => id !== claimId), blocked: false };
  }
  if (selectedIds.length >= MAX_SELECTED_CLAIMS) {
    return { ids: selectedIds, blocked: true };
  }
  const known = claims.some((claim) => claim.id === claimId);
  if (!known) return { ids: selectedIds, blocked: false };
  return { ids: [...selectedIds, claimId], blocked: false };
}

export function countByRisk(claims: Claim[]): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = { high: 0, medium: 0, low: 0 };
  for (const claim of claims) {
    counts[riskOf(claim)] += 1;
  }
  return counts;
}

/** 重叠原文标记取关联疑点中的最高风险用于配色。 */
export function highestRisk(claims: Claim[]): RiskLevel {
  return claims.reduce<RiskLevel>((current, claim) => {
    const next = riskOf(claim);
    return RISK_ORDER[next] < RISK_ORDER[current] ? next : current;
  }, 'low');
}

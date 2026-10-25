import { z } from 'zod';
import type { ClaimsPreview } from '@/types/case';

/**
 * ⑦b「疑点 1–2 个 · 30 秒后自动开查」的分流规则与会话标记。
 * 这里只放纯函数和 sessionStorage 读写，状态机在 claims-autorun-controller.ts。
 */

/** 自动开查前的等待秒数；界面文案、无障碍标签都从这里取，不要再写死数字。 */
export const AUTORUN_SECONDS = 30;

export type PreviewRoute = 'empty' | 'pick' | 'autorun';

/** pick 的原因：many=疑点 ≥3 个走 ⑦；mismatch=autoRun 与疑点数量不一致，回退手动确认。 */
export type PickReason = 'many' | 'mismatch' | null;

export type PreviewClassification = {
  route: PreviewRoute;
  pickReason: PickReason;
};

/**
 * 基于已通过 ClaimsPreviewSchema 校验的预览分流，不会再请求免费预检。
 * - 0 个：不倒计时、不查证
 * - 1–2 个且 autoRun=true 且 id 唯一：⑦b
 * - ≥3 个：⑦ 选择页
 * - 1–2 个但 autoRun=false / id 异常：回退手动确认（⑦ 选择页）
 */
export function classifyPreview(
  preview: ClaimsPreview,
  options: { expectedInput?: string } = {},
): PreviewClassification {
  const count = preview.claims.length;
  if (count === 0) return { route: 'empty', pickReason: null };
  if (count >= 3) return { route: 'pick', pickReason: 'many' };

  // 预览必须对应当前送检的文案（逐字一致）；演示 / 缓存预览对不上时不自动开查。
  if (options.expectedInput !== undefined && preview.input !== options.expectedInput) {
    return { route: 'pick', pickReason: 'mismatch' };
  }

  const ids = preview.claims.map((claim) => claim.id);
  const idsValid = ids.every((id) => id.length > 0) && new Set(ids).size === ids.length;
  // 交接只支持文案体检 + 文本；其他组合保持手动确认，不自动开查。
  const handoffCompatible = preview.mode === 'scriptcheck' && preview.inputType === 'text';
  if (!preview.autoRun || !idsValid || !handoffCompatible) {
    return { route: 'pick', pickReason: 'mismatch' };
  }

  return { route: 'autorun', pickReason: null };
}

/** 本次查证预计消耗的积分：疑点数 × 预览里的真实单价。 */
export function estimateCost(preview: ClaimsPreview): number {
  return preview.claims.length * preview.pricePerClaim;
}

const FLOW_KEY = 'claims-autorun:flow';
const FLOW_VERSION = 1;

/**
 * 会话标记：以「草稿 id」为粒度，一份草稿最多自动倒计时一次。
 * armed=已开始过倒计时；cancelled=用户取消；started=已进入办案页。
 * 刷新、浏览器返回后读到任意标记，都只进入手动确认态，不会静默恢复自动开查。
 * 只保存 id 与状态，不保存原文或 preview JSON。
 */
export const FlowMarkerSchema = z.object({
  version: z.literal(FLOW_VERSION),
  draftId: z.string().min(1),
  previewId: z.string().min(1),
  status: z.enum(['armed', 'cancelled', 'started']),
});
export type FlowMarker = z.infer<typeof FlowMarkerSchema>;

export function readFlowMarker(draftId: string): FlowMarker | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(FLOW_KEY);
    if (!raw) return null;
    const parsed = FlowMarkerSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success && parsed.data.draftId === draftId ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeFlowMarker(marker: Omit<FlowMarker, 'version'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(FLOW_KEY, JSON.stringify({ version: FLOW_VERSION, ...marker }));
  } catch {
    // 会话存储不可用时只依赖内存标记，仍然不会在同一页面内重复倒计时。
  }
}

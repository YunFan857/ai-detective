import { z } from 'zod';
import type { InputType, Mode } from '@/types/case';

/**
 * 文案体检的跨页面交接。
 * URL 只带流程名，原文和 preview 摘要放 sessionStorage，避免长文案撑爆地址栏。
 * 所有读取都做版本与结构校验，损坏 / 过期时按缺失处理。
 */

export const SCRIPTCHECK_MIN = 50;
export const SCRIPTCHECK_MAX = 1500;
export const MAX_SELECTED_CLAIMS = 10;

const DRAFT_VERSION = 1;
const HANDOFF_VERSION = 1;

const DRAFT_KEY = 'claims-check:draft';
const HANDOFF_KEY = 'claims-check:handoff';

export const ClaimsDraftSchema = z.object({
  version: z.literal(DRAFT_VERSION),
  mode: z.literal('scriptcheck'),
  inputType: z.literal('text'),
  text: z.string().min(SCRIPTCHECK_MIN).max(SCRIPTCHECK_MAX),
  createdAt: z.number().int().nonnegative(),
});
export type ClaimsDraft = z.infer<typeof ClaimsDraftSchema>;

export const ClaimsHandoffSchema = z.object({
  version: z.literal(HANDOFF_VERSION),
  mode: z.literal('scriptcheck'),
  inputType: z.literal('text'),
  previewId: z.string().min(1),
  input: z.string(),
  selectedClaimIds: z.array(z.string()).min(1).max(MAX_SELECTED_CLAIMS),
  pricePerClaim: z.number().nonnegative(),
  /** 本地积分预占交易 id；旧交接没有该字段时只展示、不扣本地积分。 */
  transactionId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
});
export type ClaimsHandoff = z.infer<typeof ClaimsHandoffSchema>;

function readJson(key: string): unknown {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // 隐私模式禁用存储时忽略
  }
}

/** 首页提交文案体检前写入草稿；返回编辑时也用它回填原文。 */
export function writeClaimsDraft(text: string): boolean {
  const trimmed = text.trim();
  const parsed = ClaimsDraftSchema.safeParse({
    version: DRAFT_VERSION,
    mode: 'scriptcheck',
    inputType: 'text',
    text: trimmed,
    createdAt: Date.now(),
  });
  if (!parsed.success) return false;
  return writeJson(DRAFT_KEY, parsed.data);
}

export function readClaimsDraft(): ClaimsDraft | null {
  const parsed = ClaimsDraftSchema.safeParse(readJson(DRAFT_KEY));
  return parsed.success ? parsed.data : null;
}

export function clearClaimsDraft(): void {
  remove(DRAFT_KEY);
}

/** 勾选确认后写入查证交接；/case 读取一次后立即删除，避免刷新重复开查。 */
export function writeClaimsHandoff(input: {
  previewId: string;
  input: string;
  selectedClaimIds: string[];
  pricePerClaim: number;
  transactionId?: string;
}): boolean {
  const parsed = ClaimsHandoffSchema.safeParse({
    version: HANDOFF_VERSION,
    mode: 'scriptcheck',
    inputType: 'text',
    previewId: input.previewId,
    input: input.input,
    selectedClaimIds: input.selectedClaimIds,
    pricePerClaim: input.pricePerClaim,
    ...(input.transactionId ? { transactionId: input.transactionId } : {}),
    createdAt: Date.now(),
  });
  if (!parsed.success) return false;
  return writeJson(HANDOFF_KEY, parsed.data);
}

export function readClaimsHandoff(): ClaimsHandoff | null {
  const parsed = ClaimsHandoffSchema.safeParse(readJson(HANDOFF_KEY));
  return parsed.success ? parsed.data : null;
}

export function clearClaimsHandoff(): void {
  remove(HANDOFF_KEY);
}

/** 页面之间只传流程名，不把业务 mode 与 mock/real/demo 混用。 */
export const CLAIMS_CHECK_HOME = '/claims';
export const CLAIMS_EDIT_HOME = '/?intake=scriptcheck';

export type ClaimsBusinessMode = Extract<Mode, 'scriptcheck'>;
export type ClaimsBusinessInput = Extract<InputType, 'text'>;

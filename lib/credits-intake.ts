import { z } from 'zod';

/**
 * 首页消息查证 → 办案页的积分预占交接。
 *
 * 首页在跳转前按自动模式上限预占积分，把交易 id 放 sessionStorage；
 * /case 只读一次即删。刷新 / 直接打开带 text 的 URL 时没有交接，
 * 办案页会明确标注「本次未经预占，不扣本地积分」，避免重复扣费。
 */
const VERSION = 1;
const KEY = 'credits-intake:v1';

export const CreditsIntakeSchema = z.object({
  version: z.literal(VERSION),
  flow: z.literal('factcheck-text'),
  transactionId: z.string().min(1),
  input: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type CreditsIntake = z.infer<typeof CreditsIntakeSchema>;

/** 写入预占交接；失败时调用方应退回预占。 */
export function writeCreditsIntake(input: { transactionId: string; input: string }): boolean {
  if (typeof window === 'undefined') return false;
  const parsed = CreditsIntakeSchema.safeParse({
    version: VERSION,
    flow: 'factcheck-text',
    transactionId: input.transactionId,
    input: input.input.trim(),
    createdAt: Date.now(),
  });
  if (!parsed.success) return false;

  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

export function readCreditsIntake(): CreditsIntake | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = CreditsIntakeSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearCreditsIntake(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // 会话存储不可用时忽略
  }
}

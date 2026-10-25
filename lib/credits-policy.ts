/**
 * 本地演示积分规则。
 *
 * 这里集中放「演示用」的数值与套餐，不冒充正式运营政策。
 * 金额只用于充值套餐展示；查证扣费与退款统一使用「积分」。
 */

/** 每个疑点的单价（积分），与后端 Billing 口径保持一致。 */
export const CREDITS_PER_CLAIM = 8;

/** 符合退款条件时，每个疑点退回的积分。 */
export const REFUND_PER_CLAIM = 4;

/** 新用户首次打开时赠送的演示积分。 */
export const INITIAL_GIFT_POINTS = 120;

/** 每日签到赠送积分。 */
export const CHECKIN_POINTS = 10;

/** 赠送积分有效期（自然日，按 Asia/Shanghai 计算）。 */
export const GIFT_VALID_DAYS = 7;

/**
 * 消息查证自动模式在请求前不知道疑点数。
 * 后端自动模式单案最多拆 3 个疑点，这里按上限预占，结案再按 billing 退回差额。
 */
export const FACTCHECK_RESERVE_CLAIMS = 3;

/** 预占上限：消息查证自动模式最多 3 个疑点。 */
export const FACTCHECK_RESERVE_POINTS = FACTCHECK_RESERVE_CLAIMS * CREDITS_PER_CLAIM;

/** 预占超过这个时长仍未收到结算，重新打开页面时自动退回。 */
export const PENDING_TRANSACTION_TTL_MS = 10 * 60 * 1000;

export type CreditPackage = {
  id: string;
  name: string;
  /** 实际到账积分（含赠送）。 */
  points: number;
  /** 套餐基础积分，用于说明赠送比例。 */
  basePoints: number;
  /** 赠送积分。 */
  bonusPoints: number;
  priceYuan: number;
  tag?: string;
  popular?: boolean;
};

/** 三档模拟充值套餐；价格单位为「元」，到账单位为「积分」。 */
export const CREDIT_PACKAGES: readonly CreditPackage[] = [
  {
    id: 'starter',
    name: '体验档',
    points: 100,
    basePoints: 100,
    bonusPoints: 0,
    priceYuan: 9.9,
  },
  {
    id: 'popular',
    name: '常用档',
    points: 330,
    basePoints: 300,
    bonusPoints: 30,
    priceYuan: 29.9,
    tag: '多送 10%',
    popular: true,
  },
  {
    id: 'pro',
    name: '专业档',
    points: 1200,
    basePoints: 1000,
    bonusPoints: 200,
    priceYuan: 99,
    tag: '多送 20%',
  },
];

export const DEFAULT_PACKAGE_ID = 'popular';

export function findCreditPackage(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((item) => item.id === id);
}

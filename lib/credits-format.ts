import type { Billing } from '@/types/case';

/**
 * 积分页与结算文案的格式化。
 * 所有日期按 Asia/Shanghai 解释；不读取设备时区，也不依赖本地时区偏移。
 */
export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

type ShanghaiParts = { year: number; month: number; day: number };

const DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function shanghaiParts(value: number | Date): ShanghaiParts {
  const date = typeof value === 'number' ? new Date(value) : value;
  const parts = DATE_PARTS.formatToParts(date);
  const read = (type: 'year' | 'month' | 'day'): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return { year: read('year'), month: read('month'), day: read('day') };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 北京时间自然日键，如 2026-10-25。 */
export function shanghaiDateKey(value: number | Date = Date.now()): string {
  const { year, month, day } = shanghaiParts(value);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * 北京时间「当天结束」的时间戳。
 * Shanghai 固定 UTC+8（无夏令时）：UTC 前一日 16:00 即当地 0 点。
 */
export function shanghaiEndOfDay(value: number, addDays = 0): number {
  const { year, month, day } = shanghaiParts(value);
  return Date.UTC(year, month - 1, day + addDays + 1, 0, 0, 0, 0) - 8 * 60 * 60 * 1000 - 1;
}

/** 如 10月31日；跨年时补年份。 */
export function formatShanghaiDay(value: number, now = Date.now()): string {
  const target = shanghaiParts(value);
  const today = shanghaiParts(now);
  return target.year === today.year
    ? `${target.month}月${target.day}日`
    : `${target.year}年${target.month}月${target.day}日`;
}

/** 如 10月25日 14:08。 */
export function formatShanghaiDateTime(value: number, now = Date.now()): string {
  const target = shanghaiParts(value);
  const today = shanghaiParts(now);
  const date =
    target.year === today.year
      ? `${target.month}月${target.day}日`
      : `${target.year}年${target.month}月${target.day}日`;
  const timeParts = DATE_TIME.formatToParts(new Date(value));
  const hour = timeParts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = timeParts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${date} ${hour}:${minute}`;
}

/** 人民币金额：整数不带小数，非整数保留一位或两位。 */
export function formatYuan(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

export type BillingSummary = {
  checkedCount: number;
  refundCount: number;
  charged: number;
  refunded: number;
  net: number;
};

/**
 * 只读结构化字段生成积分结算，不展示 billing.reason。
 * 后端 reason 里可能把「积分」写成「元」，前端不直接透传。
 */
export function summarizeBilling(billing: Billing): BillingSummary {
  const charged = Math.max(0, billing.charged);
  const refunded = Math.max(0, billing.refunded);
  return {
    checkedCount: billing.checkedClaimIds.length,
    refundCount: billing.refundClaimIds.length,
    charged,
    refunded,
    net: Math.max(0, charged - refunded),
  };
}

/** 一句可直接展示在卷宗页的积分结算说明。 */
export function billingSettlementText(billing: Billing): string {
  const summary = summarizeBilling(billing);

  if (summary.checkedCount === 0) return '本案没有可计费疑点，未扣积分。';
  if (summary.net === 0) {
    return `查证 ${summary.checkedCount} 个疑点，扣除 ${summary.charged} 积分后已全额退回，实际净扣 0 积分。`;
  }
  if (summary.refunded > 0) {
    return `查证 ${summary.checkedCount} 个疑点 · 扣除 ${summary.charged} 积分 · 退回 ${summary.refunded} 积分（${summary.refundCount} 个疑点）· 实际净扣 ${summary.net} 积分。`;
  }
  return `查证 ${summary.checkedCount} 个疑点 · 扣除 ${summary.charged} 积分 · 未产生退款 · 实际净扣 ${summary.net} 积分。`;
}

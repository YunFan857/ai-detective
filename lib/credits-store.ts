import { z } from 'zod';
import type { Billing } from '@/types/case';
import {
  CHECKIN_POINTS,
  GIFT_VALID_DAYS,
  INITIAL_GIFT_POINTS,
  PENDING_TRANSACTION_TTL_MS,
} from './credits-policy';
import { shanghaiDateKey, shanghaiEndOfDay } from './credits-format';

/**
 * 本地演示积分账本。
 *
 * - 只保存在当前浏览器 localStorage，不支持真实支付、真实订单或登录。
 * - 赠送批次与模拟充值批次分开，赠送积分有到期日，扣费先用最快到期的赠送批次。
 * - 所有增减分都写一条流水；查证使用「预占 → 结算 / 退回」两步，按 caseId + 交易 id 幂等。
 * - 不在模块加载时读 localStorage；SSR 返回固定的 loading 快照，避免 hydration mismatch。
 */

export const CREDITS_STORAGE_KEY = 'ai-detective:credits:v1';
export const CREDITS_VERSION = 1 as const;

const MAX_ENTRIES = 200;
const MAX_LOTS = 300;
const MAX_TRANSACTIONS = 100;

const LotKindSchema = z.enum(['gift', 'recharge']);

const LotSourceSchema = z.enum(['init', 'checkin', 'recharge', 'refund']);

const EntryTypeSchema = z.enum(['init', 'checkin', 'recharge', 'spend', 'refund', 'expire']);
type EntryType = z.infer<typeof EntryTypeSchema>;

const TransactionStatusSchema = z.enum(['pending', 'settled', 'released']);

const TransactionFlowSchema = z.enum(['scriptcheck', 'factcheck', 'image', 'manual']);
export type CreditTransactionFlow = z.infer<typeof TransactionFlowSchema>;

const CreditLotSchema = z.object({
  id: z.string().min(1),
  kind: LotKindSchema,
  source: LotSourceSchema,
  label: z.string(),
  amount: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  /** null = 永久有效（仅模拟充值批次）。 */
  expiresAt: z.number().int().nonnegative().nullable(),
});
export type CreditLot = z.infer<typeof CreditLotSchema>;

const CreditEntrySchema = z.object({
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
  type: EntryTypeSchema,
  /** 正数为入账，负数为扣减 / 到期。 */
  amount: z.number().int(),
  balanceAfter: z.number().int().nonnegative(),
  note: z.string(),
  transactionId: z.string().optional(),
  caseId: z.string().optional(),
});
export type CreditEntry = z.infer<typeof CreditEntrySchema>;

const AllocationSchema = z.object({
  lotId: z.string().min(1),
  amount: z.number().int().nonnegative(),
});
export type CreditAllocation = z.infer<typeof AllocationSchema>;

const CreditTransactionSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().nullable(),
  flow: TransactionFlowSchema,
  reservedPoints: z.number().int().nonnegative(),
  allocations: z.array(AllocationSchema),
  status: TransactionStatusSchema,
  charged: z.number().int().nonnegative().optional(),
  refunded: z.number().int().nonnegative().optional(),
  netPoints: z.number().int().nonnegative().optional(),
  releasedPoints: z.number().int().nonnegative().optional(),
  uncoveredPoints: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type CreditTransaction = z.infer<typeof CreditTransactionSchema>;

const CreditStateSchema = z.object({
  version: z.literal(CREDITS_VERSION),
  initializedAt: z.number().int().nonnegative(),
  lastCheckInDate: z.string().nullable(),
  lots: z.array(CreditLotSchema).max(MAX_LOTS),
  entries: z.array(CreditEntrySchema).max(MAX_ENTRIES),
  transactions: z.array(CreditTransactionSchema).max(MAX_TRANSACTIONS),
});
type CreditState = z.infer<typeof CreditStateSchema>;

export type CreditsStorageIssue = 'corrupt' | 'unavailable';

export type CreditsSnapshot = {
  status: 'loading' | 'ready';
  issue: CreditsStorageIssue | null;
  balance: number;
  giftBalance: number;
  rechargeBalance: number;
  giftLots: CreditLot[];
  rechargeLots: CreditLot[];
  /** 最新的在前。 */
  entries: CreditEntry[];
  checkedInToday: boolean;
  lastCheckInDate: string | null;
  pendingTransactions: number;
  /** 快照生成时间，供组件按北京时间格式化日期，避免在渲染中调用 Date.now()。 */
  asOf: number;
};

const LOADING_SNAPSHOT: CreditsSnapshot = {
  status: 'loading',
  issue: null,
  balance: 0,
  giftBalance: 0,
  rechargeBalance: 0,
  giftLots: [],
  rechargeLots: [],
  entries: [],
  checkedInToday: false,
  lastCheckInDate: null,
  pendingTransactions: 0,
  asOf: 0,
};

export type CreditActionFailure = {
  ok: false;
  reason: 'insufficient' | 'invalid' | 'already' | 'storage';
  message: string;
  shortfall?: number;
};

export type CheckInResult = { ok: true; amount: number; message: string } | CreditActionFailure;

export type RechargeResult = { ok: true; amount: number; message: string } | CreditActionFailure;

export type ReserveCreditsResult =
  | {
      ok: true;
      transactionId: string;
      reserved: number;
      allocations: CreditAllocation[];
    }
  | CreditActionFailure;

export type SettleCreditsResult =
  | {
      ok: true;
      already: boolean;
      charged: number;
      refunded: number;
      net: number;
      released: number;
      uncovered: number;
    }
  | CreditActionFailure;

export type ReleaseCreditsResult =
  { ok: true; already: boolean; released: number } | CreditActionFailure;

let state: CreditState | null = null;
let issue: CreditsStorageIssue | null = null;
let initialized = false;
let listenersRegistered = false;
let snapshot: CreditsSnapshot = LOADING_SNAPSHOT;
let fallbackId = 0;
const listeners = new Set<() => void>();

function nextId(prefix: string): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  fallbackId += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

function totalRemaining(stateValue: CreditState): number {
  return stateValue.lots.reduce((sum, lot) => sum + lot.remaining, 0);
}

function prune(stateValue: CreditState): void {
  if (stateValue.entries.length > MAX_ENTRIES) {
    stateValue.entries = stateValue.entries.slice(-MAX_ENTRIES);
  }
  if (stateValue.transactions.length > MAX_TRANSACTIONS) {
    stateValue.transactions = stateValue.transactions.slice(-MAX_TRANSACTIONS);
  }
  if (stateValue.lots.length > MAX_LOTS) {
    stateValue.lots = stateValue.lots.slice(-MAX_LOTS);
  }
}

function addEntry(
  stateValue: CreditState,
  input: {
    at: number;
    type: EntryType;
    amount: number;
    note: string;
    transactionId?: string;
    caseId?: string;
  },
): CreditEntry {
  const entry: CreditEntry = {
    id: nextId('entry'),
    at: input.at,
    type: input.type,
    amount: input.amount,
    balanceAfter: Math.max(0, totalRemaining(stateValue)),
    note: input.note,
    ...(input.transactionId ? { transactionId: input.transactionId } : {}),
    ...(input.caseId ? { caseId: input.caseId } : {}),
  };
  stateValue.entries.push(entry);
  prune(stateValue);
  return entry;
}

function createInitialState(now: number): CreditState {
  const lot: CreditLot = {
    id: nextId('lot'),
    kind: 'gift',
    source: 'init',
    label: '新用户演示赠送',
    amount: INITIAL_GIFT_POINTS,
    remaining: INITIAL_GIFT_POINTS,
    createdAt: now,
    expiresAt: shanghaiEndOfDay(now, GIFT_VALID_DAYS),
  };
  const initial: CreditState = {
    version: CREDITS_VERSION,
    initializedAt: now,
    lastCheckInDate: null,
    lots: [lot],
    entries: [],
    transactions: [],
  };
  addEntry(initial, {
    at: now,
    type: 'init',
    amount: INITIAL_GIFT_POINTS,
    note: `演示赠送 ${INITIAL_GIFT_POINTS} 积分（有效期 ${GIFT_VALID_DAYS} 天）`,
  });
  return initial;
}

function buildSnapshot(stateValue: CreditState | null): CreditsSnapshot {
  if (!stateValue) return { ...LOADING_SNAPSHOT, issue };

  const now = Date.now();
  const giftLots = stateValue.lots
    .filter((lot) => lot.kind === 'gift' && lot.remaining > 0)
    .sort((left, right) => {
      const leftExpiry = left.expiresAt ?? Number.MAX_SAFE_INTEGER;
      const rightExpiry = right.expiresAt ?? Number.MAX_SAFE_INTEGER;
      return leftExpiry - rightExpiry || left.createdAt - right.createdAt;
    });
  const rechargeLots = stateValue.lots
    .filter((lot) => lot.kind === 'recharge' && lot.remaining > 0)
    .sort((left, right) => left.createdAt - right.createdAt);
  const giftBalance = giftLots.reduce((sum, lot) => sum + lot.remaining, 0);
  const rechargeBalance = rechargeLots.reduce((sum, lot) => sum + lot.remaining, 0);

  return {
    status: 'ready',
    issue,
    balance: giftBalance + rechargeBalance,
    giftBalance,
    rechargeBalance,
    giftLots,
    rechargeLots,
    entries: [...stateValue.entries].reverse(),
    checkedInToday: stateValue.lastCheckInDate === shanghaiDateKey(now),
    lastCheckInDate: stateValue.lastCheckInDate,
    pendingTransactions: stateValue.transactions.filter((tx) => tx.status === 'pending').length,
    asOf: now,
  };
}

function publish(): void {
  snapshot = buildSnapshot(state);
  listeners.forEach((listener) => listener());
}

function persistState(stateValue: CreditState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CREDITS_STORAGE_KEY, JSON.stringify(stateValue));
    if (issue === 'unavailable') issue = null;
  } catch {
    issue = 'unavailable';
  }
}

function backupCorrupt(raw: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${CREDITS_STORAGE_KEY}:corrupt:${Date.now()}`, raw);
  } catch {
    // 备份失败时忽略，至少不阻塞页面初始化。
  }
}

function applyExpiry(stateValue: CreditState, now: number): boolean {
  let changed = false;
  let balance = totalRemaining(stateValue);

  for (const lot of stateValue.lots) {
    if (lot.kind !== 'gift' || lot.remaining <= 0) continue;
    if (lot.expiresAt === null || lot.expiresAt > now) continue;

    const amount = lot.remaining;
    lot.remaining = 0;
    balance -= amount;
    stateValue.entries.push({
      id: nextId('entry'),
      at: now,
      type: 'expire',
      amount: -amount,
      balanceAfter: Math.max(0, balance),
      note: `${lot.label}到期，${amount} 积分失效`,
    });
    changed = true;
  }

  if (changed) prune(stateValue);
  return changed;
}

function sortSpendableLots(stateValue: CreditState): CreditLot[] {
  return stateValue.lots
    .filter((lot) => lot.remaining > 0)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'gift' ? -1 : 1;
      const leftExpiry = left.expiresAt ?? Number.MAX_SAFE_INTEGER;
      const rightExpiry = right.expiresAt ?? Number.MAX_SAFE_INTEGER;
      return leftExpiry - rightExpiry || left.createdAt - right.createdAt;
    });
}

function consumeLots(
  stateValue: CreditState,
  points: number,
): { allocations: CreditAllocation[]; consumed: number } {
  const allocations: CreditAllocation[] = [];
  let left = points;

  for (const lot of sortSpendableLots(stateValue)) {
    if (left <= 0) break;
    const take = Math.min(left, lot.remaining);
    if (take <= 0) continue;
    lot.remaining -= take;
    left -= take;
    allocations.push({ lotId: lot.id, amount: take });
  }

  return { allocations, consumed: points - left };
}

function restoreAllocations(
  stateValue: CreditState,
  allocations: readonly CreditAllocation[],
  points: number,
): number {
  let left = points;
  let restored = 0;

  for (const allocation of [...allocations].reverse()) {
    if (left <= 0) break;
    const take = Math.min(left, allocation.amount);
    const lot = stateValue.lots.find((item) => item.id === allocation.lotId);
    if (!lot) continue;
    lot.remaining += take;
    left -= take;
    restored += take;
  }

  return restored;
}

function releaseInState(
  stateValue: CreditState,
  transaction: CreditTransaction,
  now: number,
  note: string,
): number {
  const released = restoreAllocations(
    stateValue,
    transaction.allocations,
    transaction.reservedPoints,
  );
  transaction.status = 'released';
  transaction.releasedPoints = released;
  transaction.updatedAt = now;
  transaction.note = note;

  if (released > 0) {
    addEntry(stateValue, {
      at: now,
      type: 'refund',
      amount: released,
      note,
      transactionId: transaction.id,
      ...(transaction.caseId ? { caseId: transaction.caseId } : {}),
    });
  }

  return released;
}

function recoverStaleTransactions(stateValue: CreditState, now: number): boolean {
  let changed = false;
  for (const transaction of stateValue.transactions) {
    if (transaction.status !== 'pending') continue;
    if (now - transaction.createdAt <= PENDING_TRANSACTION_TTL_MS) continue;
    releaseInState(stateValue, transaction, now, '超过 10 分钟未收到结算，预占积分已自动退回');
    changed = true;
  }
  return changed;
}

function normalizeStateFromStorage(): boolean {
  if (!state) return false;
  let changed = recoverStaleTransactions(state, Date.now());
  if (applyExpiry(state, Date.now())) changed = true;
  return changed;
}

function loadFromStorage(): void {
  if (typeof window === 'undefined') return;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CREDITS_STORAGE_KEY);
  } catch {
    issue = 'unavailable';
    state = createInitialState(Date.now());
    return;
  }

  if (!raw) {
    state = createInitialState(Date.now());
    persistState(state);
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch {
    backupCorrupt(raw);
    issue = 'corrupt';
    state = createInitialState(Date.now());
    persistState(state);
    return;
  }

  const parsed = CreditStateSchema.safeParse(parsedJson);
  if (!parsed.success) {
    backupCorrupt(raw);
    issue = 'corrupt';
    state = createInitialState(Date.now());
    persistState(state);
    return;
  }

  state = parsed.data;
  if (normalizeStateFromStorage()) persistState(state);
}

function syncFromStorage(): void {
  if (typeof window === 'undefined' || issue === 'unavailable') return;
  try {
    const raw = window.localStorage.getItem(CREDITS_STORAGE_KEY);
    if (!raw) return;
    const parsed = CreditStateSchema.safeParse(JSON.parse(raw) as unknown);
    if (parsed.success) state = parsed.data;
  } catch {
    // 读取失败时保留内存状态，不覆盖用户当前操作。
  }
}

function prepareState(): CreditState | null {
  ensureCreditsLoaded();
  if (!state) return null;
  syncFromStorage();
  if (applyExpiry(state, Date.now())) {
    persistState(state);
    publish();
  }
  return state;
}

function onStorage(event: StorageEvent): void {
  if (event.key !== CREDITS_STORAGE_KEY && event.key !== null) return;
  if (event.key === null) {
    // 其他标签页清空本地数据：本页恢复为初始演示状态，不白屏。
    state = createInitialState(Date.now());
    issue = null;
    persistState(state);
    publish();
    return;
  }

  loadFromStorage();
  publish();
}

function onVisibility(): void {
  if (document.visibilityState !== 'visible') return;
  refreshCredits();
}

function registerListeners(): void {
  if (listenersRegistered || typeof window === 'undefined') return;
  listenersRegistered = true;
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisibility);
  // 页面长时间停留时也要让赠送积分按期失效；有变化才 publish。
  if (typeof window.setInterval === 'function') {
    window.setInterval(refreshCredits, 60_000);
  }
}

/** 客户端初始化：只执行一次；SSR 阶段不会读 window/localStorage。 */
export function ensureCreditsLoaded(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  registerListeners();
  loadFromStorage();
  publish();
}

/** 供 useSyncExternalStore 使用：服务端 / 首帧固定返回 loading。 */
export function getCreditsServerSnapshot(): CreditsSnapshot {
  return LOADING_SNAPSHOT;
}

export function getCreditsSnapshot(): CreditsSnapshot {
  return snapshot;
}

export function subscribeCredits(listener: () => void): () => void {
  ensureCreditsLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 页面前台 / 定时刷新：处理到期与超时预占，没有变化时不触发重绘。 */
export function refreshCredits(): void {
  ensureCreditsLoaded();
  if (!state) return;
  syncFromStorage();
  const now = Date.now();
  const recovered = recoverStaleTransactions(state, now);
  const expired = applyExpiry(state, now);
  if (recovered || expired) {
    persistState(state);
    publish();
  }
}

export function checkInCredits(): CheckInResult {
  const current = prepareState();
  if (!current) {
    return { ok: false, reason: 'storage', message: '积分数据尚未准备好，请稍后重试。' };
  }

  const now = Date.now();
  const today = shanghaiDateKey(now);
  if (current.lastCheckInDate === today) {
    return { ok: false, reason: 'already', message: '今天已经签到过了，明天再来。' };
  }

  const lot: CreditLot = {
    id: nextId('lot'),
    kind: 'gift',
    source: 'checkin',
    label: `每日签到 ${today}`,
    amount: CHECKIN_POINTS,
    remaining: CHECKIN_POINTS,
    createdAt: now,
    expiresAt: shanghaiEndOfDay(now, GIFT_VALID_DAYS),
  };
  current.lots.push(lot);
  current.lastCheckInDate = today;
  addEntry(current, {
    at: now,
    type: 'checkin',
    amount: CHECKIN_POINTS,
    note: `每日签到 +${CHECKIN_POINTS} 积分（有效期 ${GIFT_VALID_DAYS} 天）`,
  });
  prune(current);
  persistState(current);
  publish();

  return {
    ok: true,
    amount: CHECKIN_POINTS,
    message: `签到成功，+${CHECKIN_POINTS} 积分（北京时间 ${today}）。`,
  };
}

export function rechargeCredits(input: {
  points: number;
  label: string;
  priceYuan?: number;
}): RechargeResult {
  const current = prepareState();
  if (!current) {
    return { ok: false, reason: 'storage', message: '积分数据尚未准备好，请稍后重试。' };
  }
  if (!Number.isSafeInteger(input.points) || input.points <= 0) {
    return { ok: false, reason: 'invalid', message: '充值积分数不合法。' };
  }

  const now = Date.now();
  const lot: CreditLot = {
    id: nextId('lot'),
    kind: 'recharge',
    source: 'recharge',
    label: input.label,
    amount: input.points,
    remaining: input.points,
    createdAt: now,
    expiresAt: null,
  };
  current.lots.push(lot);
  addEntry(current, {
    at: now,
    type: 'recharge',
    amount: input.points,
    note:
      input.priceYuan === undefined
        ? `${input.label} +${input.points} 积分（模拟充值，无真实付款）`
        : `${input.label} ¥${input.priceYuan} / ${input.points} 积分（模拟充值，无真实付款）`,
  });
  prune(current);
  persistState(current);
  publish();

  return {
    ok: true,
    amount: input.points,
    message: `已模拟入账 ${input.points} 积分；未发生真实支付。`,
  };
}

export function reserveCredits(input: {
  points: number;
  flow: CreditTransactionFlow;
  note: string;
  caseId?: string;
}): ReserveCreditsResult {
  const current = prepareState();
  if (!current) {
    return { ok: false, reason: 'storage', message: '积分数据尚未准备好，请稍后重试。' };
  }
  if (!Number.isSafeInteger(input.points) || input.points < 0) {
    return { ok: false, reason: 'invalid', message: '本次积分预占数额不合法。' };
  }

  const available = totalRemaining(current);
  if (available < input.points) {
    const shortfall = input.points - available;
    return {
      ok: false,
      reason: 'insufficient',
      shortfall,
      message: `积分不足，还差 ${shortfall} 积分。请先到积分中心签到或模拟充值。`,
    };
  }

  const now = Date.now();
  const { allocations, consumed } = consumeLots(current, input.points);
  const transaction: CreditTransaction = {
    id: nextId('tx'),
    caseId: input.caseId ?? null,
    flow: input.flow,
    reservedPoints: consumed,
    allocations,
    status: 'pending',
    note: input.note,
    createdAt: now,
    updatedAt: now,
  };
  current.transactions.push(transaction);
  prune(current);

  if (consumed > 0) {
    addEntry(current, {
      at: now,
      type: 'spend',
      amount: -consumed,
      note: input.note,
      transactionId: transaction.id,
      ...(input.caseId ? { caseId: input.caseId } : {}),
    });
  }

  persistState(current);
  publish();

  return {
    ok: true,
    transactionId: transaction.id,
    reserved: consumed,
    allocations,
  };
}

export function settleCredits(
  transactionId: string,
  billing: Billing,
  caseId?: string,
): SettleCreditsResult {
  const current = prepareState();
  if (!current) {
    return { ok: false, reason: 'storage', message: '积分数据尚未准备好。' };
  }

  const transaction = current.transactions.find((item) => item.id === transactionId);
  if (!transaction) {
    return {
      ok: false,
      reason: 'invalid',
      message: '没有找到对应的本地积分交易，本次不重复扣费。',
    };
  }

  if (transaction.status === 'settled') {
    return {
      ok: true,
      already: true,
      charged: transaction.charged ?? 0,
      refunded: transaction.refunded ?? 0,
      net: transaction.netPoints ?? 0,
      released: 0,
      uncovered: transaction.uncoveredPoints ?? 0,
    };
  }

  if (transaction.status === 'released') {
    // 已经退回的预占不因迟到的 billing / done 再次扣费。
    return {
      ok: true,
      already: true,
      charged: 0,
      refunded: 0,
      net: 0,
      released: transaction.releasedPoints ?? 0,
      uncovered: 0,
    };
  }

  if (caseId) {
    const settledSameCase = current.transactions.find(
      (item) => item.id !== transaction.id && item.caseId === caseId && item.status === 'settled',
    );
    if (settledSameCase) {
      const now = Date.now();
      const released = releaseInState(
        current,
        transaction,
        now,
        '同一案件已经结算，本笔预占积分退回',
      );
      persistState(current);
      publish();
      return {
        ok: true,
        already: true,
        charged: settledSameCase.charged ?? 0,
        refunded: settledSameCase.refunded ?? 0,
        net: settledSameCase.netPoints ?? 0,
        released,
        uncovered: 0,
      };
    }
  }

  const now = Date.now();
  const charged = Math.max(0, Math.round(billing.charged));
  const refunded = Math.max(0, Math.round(billing.refunded));
  const net = Math.max(0, charged - refunded);
  let released = 0;
  let uncovered = 0;

  if (net <= transaction.reservedPoints) {
    const toRefund = transaction.reservedPoints - net;
    if (toRefund > 0) {
      released = restoreAllocations(current, transaction.allocations, toRefund);
      if (released > 0) {
        addEntry(current, {
          at: now,
          type: 'refund',
          amount: released,
          note:
            billing.refundClaimIds.length > 0
              ? `结算退回 ${billing.refundClaimIds.length} 个疑点对应积分`
              : '结算差额退回',
          transactionId: transaction.id,
          ...(caseId ? { caseId } : {}),
        });
      }
    }
  } else {
    const extra = net - transaction.reservedPoints;
    const { consumed } = consumeLots(current, extra);
    uncovered = extra - consumed;
    if (consumed > 0) {
      addEntry(current, {
        at: now,
        type: 'spend',
        amount: -consumed,
        note: '按结算结果补扣',
        transactionId: transaction.id,
        ...(caseId ? { caseId } : {}),
      });
    }
  }

  transaction.status = 'settled';
  transaction.caseId = caseId ?? transaction.caseId;
  transaction.charged = charged;
  transaction.refunded = refunded;
  transaction.netPoints = net;
  transaction.releasedPoints = released;
  transaction.uncoveredPoints = uncovered;
  transaction.updatedAt = now;
  transaction.note = `${transaction.note ?? '结算'} · 净扣 ${net} 积分`;

  // 退款回到原批次后若批次已过期，立即按到期规则失效并记流水。
  applyExpiry(current, now);
  persistState(current);
  publish();

  return { ok: true, already: false, charged, refunded, net, released, uncovered };
}

export function releaseCredits(
  transactionId: string,
  note = '本次未产生费用，预占积分已退回',
): ReleaseCreditsResult {
  const current = prepareState();
  if (!current) {
    return { ok: false, reason: 'storage', message: '积分数据尚未准备好。' };
  }

  const transaction = current.transactions.find((item) => item.id === transactionId);
  if (!transaction) {
    return {
      ok: false,
      reason: 'invalid',
      message: '没有找到对应的本地积分交易。',
    };
  }

  if (transaction.status !== 'pending') {
    return {
      ok: true,
      already: true,
      released: transaction.releasedPoints ?? 0,
    };
  }

  const released = releaseInState(current, transaction, Date.now(), note);
  applyExpiry(current, Date.now());
  persistState(current);
  publish();

  return { ok: true, already: false, released };
}

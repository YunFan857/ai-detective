import type { CreditsView } from '@/lib/credits';

/**
 * ⑦b 自动开查状态机（与 React 无关，时钟 / 计时器可注入，方便用假时钟验证）。
 *
 * 一个「流程主体」(subject) = 一份送检原文 + 对应的一份预览。同一主体最多自动倒计时一次：
 * 取消 / 余额不足 / 刷新恢复 / 已开始 之后都不会再回到 counting，
 * 只有拿到新的预览（新的 subject.key）才会重新分流。
 *
 * 所有「开始查证」入口（到点、立即开始、取消后手动开始、失败重试）都只走 start()，
 * 它先同步置位启动锁、作废计时器，再做版本 / 余额校验与交接。
 * 注意：这是前端防重，不等同于服务端幂等。
 */

export type AutorunPhase =
  'idle' | 'pending' | 'counting' | 'cancelled-editable' | 'stale' | 'starting' | 'error';

/** pending 的原因：init=刚展示还没开始计时；hidden=页面在后台；credits-loading=积分读取中。 */
export type PendingReason = 'init' | 'hidden' | 'credits-loading';

/** 进入手动确认态的原因。 */
export type ManualReason = 'cancelled' | 'restored' | 'no-account' | 'insufficient';

export type StartSource = 'timer' | 'now' | 'manual' | 'retry';

export type StartResult =
  'started' | 'locked' | 'invalid' | 'stale' | 'blocked' | 'insufficient' | 'failed';

export type AutorunSubject = {
  /** 草稿 id + 预览 id；变化即视为一个全新的流程。 */
  key: string;
  previewId: string;
  claimIds: string[];
  pricePerClaim: number;
  /** 送检时的原文版本（逐字比较，不 trim）。 */
  sourceText: string;
};

export type StartPayload = {
  previewId: string;
  claimIds: string[];
  pricePerClaim: number;
};

export type AutorunEnv = {
  credits: CreditsView;
  visible: boolean;
};

export type AutorunSnapshot = {
  phase: AutorunPhase;
  secondsLeft: number;
  pendingReason: PendingReason | null;
  manualReason: ManualReason | null;
  errorMessage: string | null;
  /** 文本框里当前的内容；与 subject.sourceText 逐字比较判断是否过期。 */
  text: string;
  subjectKey: string | null;
  /** 页面曾经因后台暂停过，用于重新告知。 */
  resumedAfterHidden: boolean;
};

export type AutorunDeps = {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** 交接疑点并进入办案页；返回 false 表示交接失败，可手动重试。 */
  begin: (payload: StartPayload) => boolean;
  /** 持久化会话标记（刷新 / 返回不会静默恢复自动开查）。 */
  onMarker: (status: 'armed' | 'cancelled' | 'started') => void;
  seconds: number;
};

export const MAX_AUTORUN_CLAIMS = 2;

type Gate = 'ok' | 'loading' | 'insufficient' | 'unavailable';

/** 余额闸门：unavailable=积分账户未接入（只允许手动确认）。 */
export function creditGate(credits: CreditsView, cost: number): Gate {
  if (credits.status === 'loading') return 'loading';
  if (credits.status === 'unavailable') return 'unavailable';
  return credits.balance >= cost ? 'ok' : 'insufficient';
}

const INITIAL: AutorunSnapshot = {
  phase: 'idle',
  secondsLeft: 0,
  pendingReason: null,
  manualReason: null,
  errorMessage: null,
  text: '',
  subjectKey: null,
  resumedAfterHidden: false,
};

/** 两次 tick 间隔超过它（正常约 1 秒）说明设备休眠 / 系统时间跳变，重新给完整时长。 */
const TICK_JUMP_MS = 5000;
/** 先让用户看到完整费用提示和两个按钮，这段展示期结束后才开始完整倒计时。 */
export const REVEAL_MS = 800;
/** 卸载后多久内重新挂载仍视为同一次停留（StrictMode 模拟卸载）。 */
const REATTACH_GRACE_MS = 1500;

export class AutorunController {
  private deps: AutorunDeps;
  private lastTickAt = 0;
  private detachedAt = 0;
  /** 本轮展示期是否已走完；暂停（后台 / 积分读取）后重置，回来再给一次展示。 */
  private revealed = false;
  private snapshot: AutorunSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private subject: AutorunSubject | null = null;
  private env: AutorunEnv = {
    credits: { status: 'unavailable', message: '本地积分尚未读取' },
    visible: true,
  };
  private attached = false;
  /** 每次作废计时器 / 切换主体都自增；迟到的回调凭此失效。 */
  private epoch = 0;
  private timer: unknown = null;
  private deadline = 0;
  /** 同步启动锁：先置位，再做任何异步 / 导航。 */
  private startLock = false;
  /** 进入 stale 前所处的手动原因，改回原文后据此恢复。 */
  private staleFrom: ManualReason | null = null;

  constructor(deps: AutorunDeps) {
    this.deps = deps;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AutorunSnapshot => this.snapshot;

  // ---- 生命周期 ----------------------------------------------------------

  /** 绑定随渲染更新的回调（路由、当前预览等），不改变状态。 */
  bind(handlers: Pick<AutorunDeps, 'begin' | 'onMarker'>): void {
    this.deps = { ...this.deps, ...handlers };
  }

  attach(): void {
    this.attached = true;

    const away = this.detachedAt > 0 ? this.deps.now() - this.detachedAt : 0;
    this.detachedAt = 0;

    // 页面被缓存后再次显示（浏览器返回 / 路由保活）：不静默恢复自动开查，回到手动确认。
    // StrictMode 的模拟卸载在毫秒内重新挂载，不算离开，不受影响。
    if (this.snapshot.phase === 'starting') {
      this.startLock = false;
      this.enterManual('restored', false);
      return;
    }
    if (this.snapshot.phase === 'pending' && away > REATTACH_GRACE_MS) {
      this.enterManual('restored', false);
      return;
    }
    this.evaluate();
  }

  /** 卸载 / StrictMode 模拟卸载：停表。倒计时中的流程退回 pending，重新挂载后重新给完整时长。 */
  detach(): void {
    this.attached = false;
    this.detachedAt = this.deps.now();
    this.invalidateTimer();
    if (this.snapshot.phase === 'counting') {
      this.set({ phase: 'pending', pendingReason: 'init', secondsLeft: this.deps.seconds });
    }
  }

  /** 设置当前预览；key 不变时什么都不做（rerender / StrictMode 安全）。 */
  configure(subject: AutorunSubject | null, restored: boolean): void {
    const nextKey = subject?.key ?? null;
    if (nextKey === (this.subject?.key ?? null)) return;

    this.invalidateTimer();
    this.startLock = false;
    this.staleFrom = null;
    this.subject = subject;

    if (!subject) {
      this.set({ ...INITIAL });
      return;
    }

    this.set({
      ...INITIAL,
      subjectKey: subject.key,
      text: subject.sourceText,
      secondsLeft: this.deps.seconds,
      ...(restored
        ? { phase: 'cancelled-editable' as const, manualReason: 'restored' as const }
        : { phase: 'pending' as const, pendingReason: 'init' as const }),
    });
    // 这份文案一旦展示过 ⑦b 就留下标记：之后刷新 / 返回只会恢复到手动确认态。
    if (!restored) this.deps.onMarker('armed');
    this.evaluate();
  }

  setEnv(env: AutorunEnv): void {
    const hiddenNow = !env.visible;
    this.env = env;
    if (hiddenNow && this.snapshot.phase === 'counting') {
      this.set({ resumedAfterHidden: true });
    }
    this.evaluate();
  }

  // ---- 用户操作 ----------------------------------------------------------

  /** 取消只作用于开查前的等待；已进入 starting 则无效。 */
  cancel(): boolean {
    const { phase } = this.snapshot;
    if (phase !== 'counting' && phase !== 'pending') return false;
    if (this.startLock) return false;
    this.enterManual('cancelled', true);
    return true;
  }

  /** 文本框内容变化：与送检原文逐字比较，不 trim。 */
  setText(text: string): void {
    if (this.startLock || this.snapshot.phase === 'starting') return;
    this.set({ text });
    const subject = this.subject;
    if (!subject) return;

    if (text !== subject.sourceText) {
      if (this.snapshot.phase !== 'stale') this.markStale();
      return;
    }

    // 改回与送检时逐字相同的版本：预览重新对应当前文案，回到手动确认态。
    if (this.snapshot.phase === 'stale') {
      this.set({
        phase: 'cancelled-editable',
        manualReason: this.staleFrom ?? 'cancelled',
      });
      this.staleFrom = null;
    }
  }

  /** 到点 / 立即开始 / 手动开始 / 重试 的统一入口。 */
  start(source: StartSource): StartResult {
    if (this.startLock) return 'locked';

    const subject = this.subject;
    if (!subject) return 'invalid';

    const { phase } = this.snapshot;
    const allowed =
      source === 'timer'
        ? phase === 'counting'
        : source === 'now'
          ? phase === 'counting' || phase === 'pending'
          : source === 'manual'
            ? phase === 'cancelled-editable'
            : phase === 'error';
    if (!allowed) return 'invalid';

    // 再次校验文案版本、预览与疑点数量。
    if (this.snapshot.text !== subject.sourceText) {
      this.markStale();
      return 'stale';
    }
    const count = subject.claimIds.length;
    if (
      !subject.previewId ||
      count < 1 ||
      new Set(subject.claimIds).size !== count ||
      (source !== 'manual' && source !== 'retry' && count > MAX_AUTORUN_CLAIMS)
    ) {
      return 'invalid';
    }

    // 再次校验积分。
    const cost = count * subject.pricePerClaim;
    const gate = creditGate(this.env.credits, cost);
    const auto = source === 'timer' || source === 'now';
    if (gate === 'insufficient') {
      this.enterManual('insufficient', phase === 'counting');
      return 'insufficient';
    }
    if (gate === 'loading') {
      if (phase === 'counting') this.pause('credits-loading');
      return 'blocked';
    }
    if (gate === 'unavailable' && auto) {
      this.enterManual('no-account', phase === 'counting');
      return 'blocked';
    }
    if (source === 'timer' && !this.env.visible) {
      this.pause('hidden');
      return 'blocked';
    }

    // 提交：同步置锁 → 作废计时器 → 进入 starting → 交接。
    this.startLock = true;
    this.invalidateTimer();
    this.set({ phase: 'starting', pendingReason: null, errorMessage: null });
    this.deps.onMarker('started');

    let accepted = false;
    try {
      accepted = this.deps.begin({
        previewId: subject.previewId,
        claimIds: [...subject.claimIds],
        pricePerClaim: subject.pricePerClaim,
      });
    } catch {
      accepted = false;
    }

    if (!accepted) {
      this.startLock = false;
      this.set({
        phase: 'error',
        errorMessage: '疑点没能交接到办案页，本次未扣积分。请手动重试。',
      });
      return 'failed';
    }
    return 'started';
  }

  // ---- 内部 --------------------------------------------------------------

  private set(patch: Partial<AutorunSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private invalidateTimer(): void {
    this.revealed = false;
    this.epoch += 1;
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private cost(): number {
    const subject = this.subject;
    return subject ? subject.claimIds.length * subject.pricePerClaim : 0;
  }

  private enterManual(reason: ManualReason, persist: boolean): void {
    this.invalidateTimer();
    this.staleFrom = null;
    this.set({
      phase: 'cancelled-editable',
      manualReason: reason,
      pendingReason: null,
      secondsLeft: this.deps.seconds,
    });
    if (persist) this.deps.onMarker('cancelled');
  }

  private markStale(): void {
    const from = this.snapshot.manualReason;
    this.invalidateTimer();
    this.staleFrom = from ?? 'cancelled';
    this.set({ phase: 'stale', pendingReason: null });
  }

  private pause(reason: PendingReason): void {
    this.invalidateTimer();
    this.set({ phase: 'pending', pendingReason: reason, secondsLeft: this.deps.seconds });
  }

  /** 环境（积分 / 可见性）或阶段变化后重新判定能否继续倒计时。 */
  private evaluate(): void {
    if (!this.attached || !this.subject || this.startLock) return;
    const { phase } = this.snapshot;
    if (phase !== 'pending' && phase !== 'counting') return;

    if (!this.env.visible) {
      if (phase === 'counting' || this.snapshot.pendingReason !== 'hidden') this.pause('hidden');
      return;
    }

    const gate = creditGate(this.env.credits, this.cost());
    if (gate === 'loading') {
      if (phase === 'counting' || this.snapshot.pendingReason !== 'credits-loading') {
        this.pause('credits-loading');
      }
      return;
    }
    if (gate === 'unavailable') {
      this.enterManual('no-account', phase === 'counting');
      return;
    }
    if (gate === 'insufficient') {
      this.enterManual('insufficient', phase === 'counting');
      return;
    }

    if (phase !== 'pending') return;
    if (this.revealed) {
      this.beginCounting();
      return;
    }
    this.scheduleReveal();
  }

  private scheduleReveal(): void {
    if (this.timer !== null) return;
    const epoch = this.epoch;
    this.timer = this.deps.setTimer(() => {
      // 取消 / 立即开始 / 暂停 / 切主体后，已排队的展示期回调直接失效。
      if (epoch !== this.epoch) return;
      this.timer = null;
      if (!this.attached || this.snapshot.phase !== 'pending') return;
      this.revealed = true;
      this.evaluate();
    }, REVEAL_MS);
  }

  private beginCounting(): void {
    this.invalidateTimer();
    this.revealed = true;
    const epoch = this.epoch;
    this.deadline = this.deps.now() + this.deps.seconds * 1000;
    this.lastTickAt = this.deps.now();
    this.set({
      phase: 'counting',
      pendingReason: null,
      secondsLeft: this.deps.seconds,
    });
    this.schedule(epoch);
  }

  private schedule(epoch: number): void {
    const remaining = this.deadline - this.deps.now();
    if (remaining <= 0) {
      this.tick(epoch);
      return;
    }
    const left = Math.ceil(remaining / 1000);
    const delay = Math.max(16, remaining - (left - 1) * 1000);
    this.timer = this.deps.setTimer(() => this.tick(epoch), delay);
  }

  private tick(epoch: number): void {
    // 取消 / 立即开始 / 切主体后，已排队的旧回调在这里失效。
    if (epoch !== this.epoch || this.snapshot.phase !== 'counting') return;

    const now = this.deps.now();
    if (now - this.lastTickAt > TICK_JUMP_MS) {
      // 休眠 / 时间跳变：用户并没有真正看满倒计时，重新开始完整时长。
      this.set({ resumedAfterHidden: true });
      this.beginCounting();
      return;
    }
    this.lastTickAt = now;

    const remaining = this.deadline - now;
    if (remaining <= 0) {
      this.set({ secondsLeft: 0 });
      this.start('timer');
      return;
    }
    this.set({ secondsLeft: Math.ceil(remaining / 1000) });
    this.schedule(epoch);
  }
}

'use client';

import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import demoEventsJson from '@/mock/events-demo.json';
import { playEvents, type PlayableEvent } from '@/lib/mock-stream';
import {
  CaseEventSchema,
  type Billing,
  type CaseEvent,
  type CaseFile,
  type Claim,
  type Mode,
  type Source,
  type SourceGroup,
  type Stage,
  type Stats,
  type TimelineStep,
  type Verdict,
} from '@/types/case';

/** 一条播报：阶段推进时追加到日志列表。 */
export type BroadcastLog = {
  id: string;
  /** 毫秒时间戳。 */
  timestamp: number;
  stage: Stage;
  status: 'start' | 'done';
  message: string;
};

/** 办案实况需要逐条回放的播报事件，带到达时间。 */
export type FeedEvent =
  | { type: 'stage'; at: number; stage: Stage; status: 'start' | 'done'; message: string }
  | { type: 'source'; at: number; source: Source }
  | { type: 'groups'; at: number; groups: SourceGroup[] }
  | { type: 'error'; at: number; message: string; recoverable: boolean }
  | { type: 'verdict'; at: number; verdict: Verdict };

/**
 * 调查失败原因：
 * http=接口返回非 2xx；network=网络断开；stream=事件流没收到 done 就结束；
 * server=服务端推送了不可恢复的 error 事件。
 */
export type InvestigationFailure =
  | { kind: 'http'; status: number; message: string }
  | { kind: 'network' | 'stream' | 'server'; message: string };

export type InvestigationState = {
  caseId: string | null;
  input: string;
  /** 图片立案时压缩后的截图（data URL），用于来源小卡缩略图。 */
  inputImage: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  currentStage: Stage | null;
  logs: BroadcastLog[];
  /** 播报流：stage / source / groups / error / verdict 按到达顺序累积。 */
  feed: FeedEvent[];
  /** 本案第一条事件的时间，用于播报 mm:ss。 */
  startedAt: number | null;
  /** done 事件时间；结案气泡用它计算 mm:ss。 */
  closedAt: number | null;
  claims: Claim[];
  sourcesById: Record<string, Source>;
  sourceOrder: string[];
  groups: SourceGroup[];
  timelines: Record<string, TimelineStep[]>;
  verdict: Verdict | null;
  stats: Stats | null;
  /** 逐个疑点的处理状态；文案体检选完后由 SSE 推送。 */
  claimProgress: Record<string, 'queued' | 'searching' | 'grading' | 'done'>;
  /** 服务端结算结果；billing 事件优先，done.caseFile.billing 兜底。 */
  billing: Billing | null;
  errors: string[];
  /** 终止本次调查的原因；running/done 时为 null。 */
  failure: InvestigationFailure | null;
};

export type StartOptions =
  | { mode: 'mock'; speed?: number }
  | { mode: 'demo'; demoId: string }
  | { mode: 'real'; inputType: 'text'; text: string }
  | { mode: 'real'; inputType: 'link'; url: string }
  | {
      mode: 'real';
      inputType: 'image';
      image: string;
      /** 已确认的拆疑点预览；传入后跳过视觉转写，只深查选中的疑点。 */
      previewId?: string;
      selectedClaimIds?: string[];
    }
  | {
      /** 已确认预览的文案 / 消息查证：mode 是业务模式，不是 mock/real/demo。 */
      flow: 'preview';
      mode: Mode;
      inputType: 'text';
      /** preview 失效时的展示兜底；服务端以 previewId 为准。 */
      text?: string;
      previewId: string;
      selectedClaimIds: string[];
    };

export type InvestigationController = {
  state: InvestigationState;
  start: (options: StartOptions, session?: ActiveCaseSession) => void;
  stop: () => void;
};

/**
 * 正在运行的办案页：首页据此展示「正在立案」入口，并可一键终止。
 * 只登记真实查证；mock / 演示回放不产生会话，避免首页出现误导入口。
 */
export type ActiveCaseSession = {
  /** 办案页地址，首页点击后直接回到该页继续看进度。 */
  href: string;
  /** 原始消息，用于首页提示。 */
  input: string;
  /** 立案方式中文名，如「文字立案」。 */
  label: string;
  /** 首页终止办案时调用：退回预占积分等收尾。 */
  onTerminate?: () => void;
};

const INITIAL_STATE: InvestigationState = {
  caseId: null,
  input: '',
  inputImage: null,
  status: 'idle',
  currentStage: null,
  logs: [],
  feed: [],
  startedAt: null,
  closedAt: null,
  claims: [],
  sourcesById: {},
  sourceOrder: [],
  groups: [],
  timelines: {},
  verdict: null,
  stats: null,
  claimProgress: {},
  billing: null,
  errors: [],
  failure: null,
};

/** mock 数据在模块加载时按契约校验一次；delayMs 是回放用的额外字段。 */
const DEMO_EVENTS: PlayableEvent[] = z
  .array(CaseEventSchema.and(z.object({ delayMs: z.number().optional() })))
  .parse(demoEventsJson);

function applyEvent(state: InvestigationState, event: CaseEvent, at: number): InvestigationState {
  switch (event.type) {
    case 'case':
      return {
        ...state,
        caseId: event.id,
        input: event.input,
        startedAt: state.startedAt ?? at,
      };

    case 'stage':
      return {
        ...state,
        currentStage: event.stage,
        logs: [
          ...state.logs,
          {
            id: `${at}-${event.stage}-${event.status}-${state.logs.length}`,
            timestamp: at,
            stage: event.stage,
            status: event.status,
            message: event.message,
          },
        ],
        feed: [
          ...state.feed,
          {
            type: 'stage',
            at,
            stage: event.stage,
            status: event.status,
            message: event.message,
          },
        ],
      };

    case 'claims':
      return { ...state, claims: event.claims };

    case 'claim_progress':
      return {
        ...state,
        claimProgress: { ...state.claimProgress, [event.claimId]: event.status },
      };

    case 'billing':
      // billing 事件与 done.caseFile.billing 可能重复到达；以事件为准，幂等覆盖。
      return { ...state, billing: event.billing };

    case 'source': {
      const known = state.sourceOrder.includes(event.source.id);
      return {
        ...state,
        sourcesById: { ...state.sourcesById, [event.source.id]: event.source },
        sourceOrder: known ? state.sourceOrder : [...state.sourceOrder, event.source.id],
        feed: known ? state.feed : [...state.feed, { type: 'source', at, source: event.source }],
      };
    }

    case 'source_update': {
      const current = state.sourcesById[event.id];
      if (!current) return state;
      const next: Source = { ...current, ...event.patch };
      return { ...state, sourcesById: { ...state.sourcesById, [event.id]: next } };
    }

    case 'groups':
      return {
        ...state,
        groups: event.groups,
        feed: [...state.feed, { type: 'groups', at, groups: event.groups }],
      };

    case 'timeline':
      return { ...state, timelines: { ...state.timelines, [event.claimId]: event.steps } };

    case 'verdict':
      return {
        ...state,
        verdict: event.verdict,
        feed: [...state.feed, { type: 'verdict', at, verdict: event.verdict }],
      };

    case 'stats':
      return { ...state, stats: event.stats };

    case 'error':
      return {
        ...state,
        status: event.recoverable ? state.status : 'error',
        errors: [...state.errors, event.message],
        failure: event.recoverable
          ? state.failure
          : { kind: 'server', message: event.message },
        feed: [
          ...state.feed,
          {
            type: 'error',
            at,
            message: event.message,
            recoverable: event.recoverable,
          },
        ],
      };

    case 'done':
      return {
        ...state,
        caseId: event.caseFile.id,
        input: event.caseFile.input,
        status: 'done',
        closedAt: at,
        startedAt: state.startedAt ?? at,
        currentStage: state.currentStage ?? 'verdict',
        claims: event.caseFile.claims,
        sourcesById: Object.fromEntries(
          event.caseFile.sources.map((source) => [source.id, source]),
        ),
        sourceOrder: event.caseFile.sources.map((source) => source.id),
        groups: event.caseFile.groups,
        timelines: event.caseFile.timelines,
        verdict: event.caseFile.verdict,
        stats: event.caseFile.stats,
        // billing 事件已先到则保留；只有没收到事件时才用卷宗兜底。
        billing: state.billing ?? event.caseFile.billing ?? null,
        errors: [],
        failure: null,
      };
  }

  return state;
}

/**
 * 调查状态放在模块级单例：办案页被缓存/隐藏或返回首页时事件流不中断，
 * 首页也能实时读到「正在办案」并随时终止。
 */
type InvestigationStore = {
  state: InvestigationState;
  /** 正在运行的办案会话；结案、失败、终止后清空。 */
  session: ActiveCaseSession | null;
  /** 被终止的办案页地址：回到该页时不自动重开同一案。 */
  terminatedHref: string | null;
};

const SERVER_SNAPSHOT: InvestigationStore = {
  state: INITIAL_STATE,
  session: null,
  terminatedHref: null,
};

let store: InvestigationStore = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
/** 当前事件流的取消函数；同一时刻只允许一个调查在跑。 */
let cancelCurrent: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): InvestigationStore {
  return store;
}

function getServerSnapshot(): InvestigationStore {
  return SERVER_SNAPSHOT;
}

function publish(next: InvestigationStore): void {
  store = next;
  for (const listener of listeners) listener();
}

/** 结案 / 失败后办案会话结束，首页的「正在立案」入口随之消失。 */
function liveSession(
  state: InvestigationState,
  session: ActiveCaseSession | null,
): ActiveCaseSession | null {
  return state.status === 'done' || state.status === 'error' ? null : session;
}

function dispatchEvent(event: CaseEvent, at: number): void {
  const state = applyEvent(store.state, event, at);
  publish({ ...store, state, session: liveSession(state, store.session) });
}

function fail(failure: InvestigationFailure): void {
  publish({
    ...store,
    state: {
      ...store.state,
      status: 'error',
      errors: [...store.state.errors, failure.message],
      failure,
    },
    session: null,
  });
}

type StreamOptions = Exclude<StartOptions, { mode: 'mock' }>;

type RequestBody = {
  demoId?: string;
  mode?: Mode;
  inputType?: 'text' | 'link' | 'image';
  text?: string;
  url?: string;
  image?: string;
  previewId?: string;
  selectedClaimIds?: string[];
};

function toRequestBody(options: StreamOptions): RequestBody {
  if ('flow' in options && options.flow === 'preview') {
    // 业务模式必须显式传给服务端；不能把 mock/real/demo 当成 factcheck/scriptcheck。
    return {
      mode: options.mode,
      inputType: 'text',
      ...(options.text ? { text: options.text } : {}),
      previewId: options.previewId,
      selectedClaimIds: options.selectedClaimIds,
    };
  }

  if (options.mode === 'demo') {
    return { demoId: options.demoId };
  }

  switch (options.inputType) {
    case 'text':
      return { inputType: 'text', text: options.text };
    case 'link':
      return { inputType: 'link', url: options.url };
    case 'image':
      // 带 previewId 时后端直接用已确认的疑点，不再上传一遍图片。
      return options.previewId
        ? {
            inputType: 'image',
            previewId: options.previewId,
            ...(options.selectedClaimIds?.length
              ? { selectedClaimIds: options.selectedClaimIds }
              : {}),
          }
        : { inputType: 'image', image: options.image };
  }
}

/** 开发期事件体检结果：同时打印到控制台并挂到 window 便于验收。 */
type EventDiagnostics = {
  eventTypes: Record<string, number>;
  claims: number;
  sources: number;
  groups: number;
  timelineClaims: number;
  timelineSteps: number;
  missingSite: number;
  missingTitle: number;
  missingSnippet: number;
  missingPublishedAt: number;
  unparsablePublishedAt: number;
  nonHttpUrl: number;
  maxTitleLength: number;
  maxSnippetLength: number;
  averageSnippetLength: number;
  longestSnippets: { site: string; length: number; head: string }[];
  emptySiteSamples: string[];
  publishedAtSamples: string[];
  verdictSummaryLength: number;
  headlineLength: number;
  rebuttalBodyLength: number;
};

type DebugWindow = Window & { __investigationDebug?: EventDiagnostics };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || '域名不详';
  } catch {
    return '域名不详';
  }
}

function collectDiagnostics(
  counts: Map<string, number>,
  caseFile?: CaseFile,
): EventDiagnostics | undefined {
  if (!caseFile) return undefined;

  const sources = caseFile.sources;
  const empty = (value: string): boolean => value.trim().length === 0;
  const publishedDates = sources
    .map((source) => source.publishedAt)
    .filter((value): value is string => Boolean(value));
  const snippets = sources.map((source) => source.snippet);
  const timelines = Object.values(caseFile.timelines);
  const timelineSteps = timelines.flat();
  const longestSnippets = [...sources]
    .sort((left, right) => right.snippet.length - left.snippet.length)
    .slice(0, 3)
    .map((source) => ({
      site: source.site || hostOf(source.url),
      length: source.snippet.length,
      head: source.snippet.slice(0, 40),
    }));

  return {
    eventTypes: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
    claims: caseFile.claims.length,
    sources: sources.length,
    groups: caseFile.groups.length,
    timelineClaims: timelines.length,
    timelineSteps: timelineSteps.length,
    missingSite: sources.filter((source) => empty(source.site)).length,
    missingTitle: sources.filter((source) => empty(source.title)).length,
    missingSnippet: sources.filter((source) => empty(source.snippet)).length,
    missingPublishedAt: sources.length - publishedDates.length,
    unparsablePublishedAt: publishedDates.filter((value) => Number.isNaN(Date.parse(value)))
      .length,
    nonHttpUrl: sources.filter((source) => !/^https?:\/\//i.test(source.url)).length,
    maxTitleLength: sources.reduce((max, source) => Math.max(max, source.title.length), 0),
    maxSnippetLength: snippets.reduce((max, snippet) => Math.max(max, snippet.length), 0),
    averageSnippetLength: snippets.length
      ? Math.round(snippets.reduce((total, snippet) => total + snippet.length, 0) / snippets.length)
      : 0,
    longestSnippets,
    emptySiteSamples: sources
      .filter((source) => empty(source.site))
      .slice(0, 5)
      .map((source) => source.url),
    publishedAtSamples: publishedDates.slice(0, 5),
    verdictSummaryLength: caseFile.verdict?.summary.length ?? 0,
    headlineLength: caseFile.verdict?.headline.length ?? 0,
    rebuttalBodyLength: caseFile.verdict?.rebuttalCard.body.length ?? 0,
  };
}

function reportDiagnostics(counts: Map<string, number>, caseFile?: CaseFile): void {
  if (process.env.NODE_ENV === 'production') return;

  const diagnostics = collectDiagnostics(counts, caseFile);
  if (!diagnostics) {
    console.info('[investigate] 事件类型统计', Object.fromEntries(counts));
    return;
  }

  console.info('[investigate] 事件类型统计', diagnostics.eventTypes);
  console.info('[investigate] 真实数据体检', diagnostics);
  (window as DebugWindow).__investigationDebug = diagnostics;
}

/**
 * 取出 buffer 中已完整的 SSE 事件块，返回尚未收完的尾部。
 * 事件按 `\n\n` 分割；`data:` 后为 JSON；以 `:` 开头的心跳行直接被忽略。
 */
function drainEventBlocks(
  buffer: string,
  onEvent: (event: CaseEvent) => void,
  onInvalid?: () => void,
): string {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';

  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');

    if (!data) continue;

    try {
      const parsed: unknown = JSON.parse(data);
      onEvent(CaseEventSchema.parse(parsed));
    } catch {
      // 单条事件解析失败时跳过，不中断整条事件流。
      onInvalid?.();
    }
  }

  return rest;
}

/** 接口返回非 2xx：由页面展示「友好提示 + 返回首页」，不再重试当前流。 */
class InvestigationHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`立案失败（HTTP ${status}）`);
    this.name = 'InvestigationHttpError';
    this.status = status;
  }
}

async function consumeEventStream(
  options: StreamOptions,
  signal: AbortSignal,
  onEvent: (event: CaseEvent) => void,
  onInvalid?: () => void,
): Promise<void> {
  const response = await fetch('/api/investigate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(toRequestBody(options)),
    signal,
  });

  if (!response.ok) {
    throw new InvestigationHttpError(response.status);
  }
  if (!response.body) {
    throw new Error('响应没有事件流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = drainEventBlocks(buffer, onEvent, onInvalid);
    }

    buffer += decoder.decode();
    if (buffer.trim() !== '') {
      drainEventBlocks(`${buffer}\n\n`, onEvent, onInvalid);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 开一个新案：mock 回放与真实接口共用同一套事件累积。
 * session 只在真实查证时传入，首页据此展示「正在立案」并可终止。
 */
function startInvestigation(options: StartOptions, session?: ActiveCaseSession): void {
  cancelCurrent?.();
  cancelCurrent = null;

  const isPreviewFlow = 'flow' in options && options.flow === 'preview';
  publish({
    state: {
      ...INITIAL_STATE,
      status: 'running',
      inputImage:
        !isPreviewFlow && options.mode === 'real' && options.inputType === 'image'
          ? options.image
          : null,
    },
    session: session ?? null,
    terminatedHref: null,
  });

  if (!isPreviewFlow && options.mode === 'mock') {
    cancelCurrent = playEvents(
      DEMO_EVENTS,
      (event) => dispatchEvent(event, Date.now()),
      options.speed ?? 1,
    );
    return;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  cancelCurrent = abort;

  void (async () => {
    let completed = false;
    let reported = false;
    /** 服务端已经推送不可恢复的错误，流随后关闭时不再重复判成「意外结束」。 */
    let serverFailed = false;
    const counts = new Map<string, number>();
    const count = (type: string): void => {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    };
    const report = (caseFile?: CaseFile): void => {
      if (reported) return;
      reported = true;
      reportDiagnostics(counts, caseFile);
    };

    try {
      await consumeEventStream(
        options,
        controller.signal,
        (event) => {
          count(event.type);
          if (event.type === 'done') {
            completed = true;
            report(event.caseFile);
          }
          if (event.type === 'error' && !event.recoverable) {
            serverFailed = true;
          }
          dispatchEvent(event, Date.now());
        },
        () => count('invalid'),
      );

      if (!controller.signal.aborted && !completed && !serverFailed) {
        fail({ kind: 'stream', message: '事件流意外结束，没等到结案报告' });
      }
    } catch (error) {
      if (controller.signal.aborted) return;

      const failure: InvestigationFailure =
        error instanceof InvestigationHttpError
          ? { kind: 'http', status: error.status, message: error.message }
          : error instanceof TypeError
            ? { kind: 'network', message: '网络连接中断，请检查网络后重试' }
            : { kind: 'stream', message: '立案没有正常返回事件流，请重新调查' };

      fail(failure);
    } finally {
      report();
      if (cancelCurrent === abort) cancelCurrent = null;
    }
  })();
}

/** 主动停止当前调查：中止事件流并回到未开始状态。 */
function stopInvestigation(): void {
  cancelCurrent?.();
  cancelCurrent = null;

  const session = store.session;
  publish({
    state: store.state.status === 'running' ? { ...store.state, status: 'idle' } : store.state,
    session: null,
    terminatedHref: session?.href ?? store.terminatedHref,
  });
}

/** 首页「终止办案」：先退回预占积分等收尾，再中止事件流。 */
export function terminateActiveCase(): void {
  const session = store.session;
  if (!session) return;

  session.onTerminate?.();
  cancelCurrent?.();
  cancelCurrent = null;
  publish({
    state: store.state.status === 'running' ? { ...store.state, status: 'idle' } : store.state,
    session: null,
    terminatedHref: session.href,
  });
}

/** 首页重新立案前清掉上一轮终止标记，避免同一地址被误判为「已在办案」。 */
export function resetCaseSession(): void {
  if (!store.session && !store.terminatedHref) return;
  publish({ ...store, session: null, terminatedHref: null });
}

/** 该办案地址已有会话或刚被终止：办案页重新可见时不要重复开同一案。 */
export function isCaseSessionBlocked(href: string): boolean {
  return store.session?.href === href || store.terminatedHref === href;
}

/** 本页是否被主动终止：办案页据此展示「已终止」，而不是继续看起来在跑。 */
export function useCaseTermination(href: string | null): boolean {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return href !== null && snapshot.terminatedHref === href;
}

/** 首页读取正在运行的办案会话；没有时返回 null。 */
export function useActiveCase(): ActiveCaseSession | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).session;
}

/**
 * 调查事件流订阅 Hook：mock 回放与真实接口共用同一套状态。
 * 状态在模块级单例里，页面切走不会中断正在跑的调查。
 */
export function useInvestigation(): InvestigationController {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return { state: snapshot.state, start: startInvestigation, stop: stopInvestigation };
}

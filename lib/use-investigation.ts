'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { z } from 'zod';
import demoEventsJson from '@/mock/events-demo.json';
import { playEvents, type PlayableEvent } from '@/lib/mock-stream';
import {
  CaseEventSchema,
  type CaseEvent,
  type Claim,
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

export type InvestigationState = {
  caseId: string | null;
  input: string;
  status: 'idle' | 'running' | 'done' | 'error';
  currentStage: Stage | null;
  logs: BroadcastLog[];
  claims: Claim[];
  sourcesById: Record<string, Source>;
  sourceOrder: string[];
  groups: SourceGroup[];
  timelines: Record<string, TimelineStep[]>;
  verdict: Verdict | null;
  stats: Stats | null;
  errors: string[];
};

export type StartOptions =
  | { mode: 'mock'; speed?: number }
  | { mode: 'demo'; demoId: string }
  | { mode: 'real'; inputType: 'text'; text: string }
  | { mode: 'real'; inputType: 'link'; url: string }
  | { mode: 'real'; inputType: 'image'; image: string };

export type InvestigationController = {
  state: InvestigationState;
  start: (options: StartOptions) => void;
  stop: () => void;
};

const INITIAL_STATE: InvestigationState = {
  caseId: null,
  input: '',
  status: 'idle',
  currentStage: null,
  logs: [],
  claims: [],
  sourcesById: {},
  sourceOrder: [],
  groups: [],
  timelines: {},
  verdict: null,
  stats: null,
  errors: [],
};

/** mock 数据在模块加载时按契约校验一次；delayMs 是回放用的额外字段。 */
const DEMO_EVENTS: PlayableEvent[] = z
  .array(CaseEventSchema.and(z.object({ delayMs: z.number().optional() })))
  .parse(demoEventsJson);

type Action =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'fail'; message: string }
  | { type: 'event'; event: CaseEvent; at: number };

function applyEvent(state: InvestigationState, event: CaseEvent, at: number): InvestigationState {
  switch (event.type) {
    case 'case':
      return { ...state, caseId: event.id, input: event.input };

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
      };

    case 'claims':
      return { ...state, claims: event.claims };

    case 'source': {
      const known = state.sourceOrder.includes(event.source.id);
      return {
        ...state,
        sourcesById: { ...state.sourcesById, [event.source.id]: event.source },
        sourceOrder: known ? state.sourceOrder : [...state.sourceOrder, event.source.id],
      };
    }

    case 'source_update': {
      const current = state.sourcesById[event.id];
      if (!current) return state;
      const next: Source = { ...current, ...event.patch };
      return { ...state, sourcesById: { ...state.sourcesById, [event.id]: next } };
    }

    case 'groups':
      return { ...state, groups: event.groups };

    case 'timeline':
      return { ...state, timelines: { ...state.timelines, [event.claimId]: event.steps } };

    case 'verdict':
      return { ...state, verdict: event.verdict };

    case 'stats':
      return { ...state, stats: event.stats };

    case 'error':
      return {
        ...state,
        status: event.recoverable ? state.status : 'error',
        errors: [...state.errors, event.message],
      };

    case 'done':
      return {
        ...state,
        caseId: event.caseFile.id,
        input: event.caseFile.input,
        status: 'done',
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
        errors: [],
      };
  }

  return state;
}

function investigationReducer(state: InvestigationState, action: Action): InvestigationState {
  switch (action.type) {
    case 'start':
      return { ...INITIAL_STATE, status: 'running' };

    case 'stop':
      return state.status === 'running' ? { ...state, status: 'idle' } : state;

    case 'fail':
      return { ...state, status: 'error', errors: [...state.errors, action.message] };

    case 'event':
      return applyEvent(state, action.event, action.at);
  }
}

type StreamOptions = Exclude<StartOptions, { mode: 'mock' }>;

function toRequestBody(options: StreamOptions): Record<string, string> {
  if (options.mode === 'demo') {
    return { demoId: options.demoId };
  }

  switch (options.inputType) {
    case 'text':
      return { inputType: 'text', text: options.text };
    case 'link':
      return { inputType: 'link', url: options.url };
    case 'image':
      return { inputType: 'image', image: options.image };
  }
}

/**
 * 取出 buffer 中已完整的 SSE 事件块，返回尚未收完的尾部。
 * 事件按 `\n\n` 分割；`data:` 后为 JSON；以 `:` 开头的心跳行直接被忽略。
 */
function drainEventBlocks(
  buffer: string,
  onEvent: (event: CaseEvent) => void,
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
    }
  }

  return rest;
}

async function consumeEventStream(
  options: StreamOptions,
  signal: AbortSignal,
  onEvent: (event: CaseEvent) => void,
): Promise<void> {
  const response = await fetch('/api/investigate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(toRequestBody(options)),
    signal,
  });

  if (!response.ok) {
    throw new Error(`立案失败（HTTP ${response.status}）`);
  }
  if (!response.body) {
    throw new Error('立案失败（响应没有事件流）');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = drainEventBlocks(buffer, onEvent);
    }

    buffer += decoder.decode();
    if (buffer.trim() !== '') {
      drainEventBlocks(`${buffer}\n\n`, onEvent);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 调查事件流订阅 Hook：mock 回放与真实接口共用同一套 reducer。
 * 组件卸载或调用 stop() 时中止正在播放/请求的事件流。
 */
export function useInvestigation(): InvestigationController {
  const [state, dispatch] = useReducer(investigationReducer, INITIAL_STATE);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    dispatch({ type: 'stop' });
  }, []);

  const start = useCallback((options: StartOptions) => {
    stopRef.current?.();
    stopRef.current = null;
    dispatch({ type: 'start' });

    if (options.mode === 'mock') {
      const cancel = playEvents(
        DEMO_EVENTS,
        (event) => dispatch({ type: 'event', event, at: Date.now() }),
        options.speed ?? 1,
      );
      stopRef.current = cancel;
      return;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    stopRef.current = abort;

    void (async () => {
      let completed = false;

      try {
        await consumeEventStream(options, controller.signal, (event) => {
          if (event.type === 'done') completed = true;
          dispatch({ type: 'event', event, at: Date.now() });
        });

        if (!controller.signal.aborted && !completed) {
          dispatch({ type: 'fail', message: '事件流意外结束' });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        dispatch({
          type: 'fail',
          message: error instanceof Error ? error.message : '立案失败',
        });
      } finally {
        if (stopRef.current === abort) stopRef.current = null;
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, []);

  return { state, start, stop };
}

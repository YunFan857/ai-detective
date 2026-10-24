/**
 * 立案接口：SSE 推送结案过程。
 * 演示 / mock 走卷宗回放，真实请求走 runInvestigation；请求中断即停止流水线。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { findDemoCaseByInput, loadDemoCase, loadPreview } from '../../../lib/case-store';
import { InvalidImageError, VisionUnavailableError } from '../../../lib/llm';
import { runInvestigation } from '../../../lib/pipeline';
import { extractImageIntake, ImageTextMissingError } from '../../../lib/pipeline/intake';
import { caseFileToEvents, type ReplayEvent } from '../../../lib/replay';
import {
  CaseEventSchema,
  ClaimSchema,
  InputTypeSchema,
  ModeSchema,
  type CaseEvent,
} from '../../../types/case';

// Cache Components 下不允许 runtime / dynamic 段配置：默认即为 Node.js 运行时、按请求执行。
// 软超时最多 120 秒，这里留出落盘与收尾余量；Vercel 套餐不足时以本地演示为准。
export const maxDuration = 150;

/** 演示回放总时长，保证现场节奏稳定。 */
const DEMO_REPLAY_MS = 20000;
/** SSE 心跳间隔。 */
const HEARTBEAT_MS = 10000;
const MIN_TEXT = 4;
const MAX_TEXT = 500;
const MAX_CLAIMS = 15;
const MAX_SELECTED = 10;

const BodySchema = z.object({
  inputType: InputTypeSchema.optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  image: z.string().optional(),
  demoId: z.string().optional(),
  mock: z.boolean().optional(),
  mode: ModeSchema.optional(),
  previewId: z.string().optional(),
  claims: z.array(ClaimSchema).max(MAX_CLAIMS).optional(),
  selectedClaimIds: z.array(z.string()).min(1).max(MAX_SELECTED).optional(),
});

type Body = z.infer<typeof BodySchema>;
type RunStream = (emit: (event: CaseEvent) => void, signal: AbortSignal) => Promise<void>;

function fail(status: number, error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取 mock/*.json 中扁平结构的事件（事件字段 + delayMs）。 */
async function loadMockEvents(name: string): Promise<ReplayEvent[]> {
  const file = path.join(process.cwd(), 'mock', name);
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`mock 事件不是数组：${name}`);
  }

  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`mock 事件格式错误：${name}`);
    }
    const record = item as Record<string, unknown>;
    const { delayMs, ...rest } = record;
    return {
      delayMs: typeof delayMs === 'number' && delayMs > 0 ? delayMs : 0,
      event: CaseEventSchema.parse(rest),
    };
  });
}

/** 按 delayMs 顺序回放事件；中断时抛错并停止。 */
function replayEvents(events: ReplayEvent[]): RunStream {
  return async (emit, signal) => {
    for (const item of events) {
      if (item.delayMs > 0) {
        await sleep(item.delayMs, undefined, { signal });
      }
      if (signal.aborted) {
        throw new Error('请求已中断');
      }
      emit(item.event);
    }
  };
}

/** 把一次执行包装成 SSE 响应，附带 10 秒心跳与中断处理。 */
function streamResponse(request: Request, run: RunStream): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const onAbort = (): void => {
    abort.abort();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const emit = (event: CaseEvent): void => {
        write(`data: ${JSON.stringify(event)}\n\n`);
      };

      heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      request.signal.addEventListener('abort', onAbort);

      void run(emit, abort.signal)
        .catch((error: unknown) => {
          if (abort.signal.aborted) return;
          emit({ type: 'error', message: messageOf(error), recoverable: false });
        })
        .finally(() => {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          request.signal.removeEventListener('abort', onAbort);
          try {
            controller.close();
          } catch {
            // 客户端已取消，流已关闭
          }
        });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** 预览分支：用 preview 里的疑点直接立案，不再重新拆解。 */
async function startFromPreview(
  request: Request,
  body: Body,
  text: string,
): Promise<Response> {
  const preview = body.previewId ? await loadPreview(body.previewId) : undefined;
  const pool = preview?.claims ?? body.claims;
  if (!pool || pool.length === 0) {
    return fail(404, 'preview_not_found', '找不到该预览，请先重新拆解疑点');
  }

  const input = (preview?.input ?? text).trim();
  if (!input) {
    return fail(400, 'empty_input', '缺少待查证文本');
  }

  const { selectedClaimIds } = body;
  if (selectedClaimIds) {
    const ids = new Set(pool.map((claim) => claim.id));
    const missing = selectedClaimIds.filter((id) => !ids.has(id));
    if (missing.length > 0) {
      return fail(400, 'unknown_claim_id', `预览中不存在疑点：${missing.join('、')}`);
    }
  }

  const previewId = body.previewId;
  const mode = preview?.mode ?? body.mode ?? 'factcheck';

  return streamResponse(request, async (emit, signal) => {
    await runInvestigation(input, emit, {
      signal,
      mode,
      claims: pool,
      ...(selectedClaimIds ? { selectedClaimIds } : {}),
      ...(previewId ? { previewId } : {}),
    });
  });
}

/**
 * 图片立案：先转写截图文字与画面线索，再把结果接入现有查证流水线。
 * 识别失败返回 4xx；未配置视觉模型返回 501，避免伪装成查证失败。
 */
async function startFromImage(request: Request, body: Body): Promise<Response> {
  const image = body.image?.trim();
  if (!image) {
    return fail(400, 'invalid_image', '缺少图片数据');
  }

  const mode = body.mode ?? 'factcheck';
  if (process.env.USE_MOCK === 'true' || body.mock === true) {
    const events = await loadMockEvents(
      mode === 'scriptcheck' ? 'script-events-demo.json' : 'events-demo.json',
    );
    return streamResponse(request, replayEvents(events));
  }

  let intake: Awaited<ReturnType<typeof extractImageIntake>>;
  try {
    intake = await extractImageIntake(image, { signal: request.signal });
  } catch (error) {
    if (error instanceof VisionUnavailableError) {
      return fail(501, 'vision_not_deployed', '截图已提交，但图片查证能力尚未部署');
    }
    if (error instanceof InvalidImageError) {
      return fail(400, 'invalid_image', messageOf(error));
    }
    if (error instanceof ImageTextMissingError) {
      return fail(422, 'image_unreadable', messageOf(error));
    }
    return fail(502, 'image_extract_failed', `截图识别失败：${messageOf(error)}`);
  }

  return streamResponse(request, async (emit, signal) => {
    await runInvestigation(intake.input, emit, { signal, mode });
  });
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail(400, 'invalid_json', '请求体必须是合法 JSON');
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return fail(400, 'invalid_body', '请求参数不合法（text / claims / selectedClaimIds 等）');
  }

  const body = parsed.data;
  const text = body.text?.trim() ?? '';
  const inputType = body.inputType ?? 'text';

  if (inputType !== 'text' && inputType !== 'image') {
    return fail(501, 'unsupported_input_type', '当前阶段仅支持文本与图片输入，链接 / 视频解析尚未接入');
  }

  try {
    // 已确认的预览优先：图片立案也会先拆疑点，确认后带 previewId 直接深查。
    if (body.previewId) {
      return await startFromPreview(request, body, text);
    }

    if (inputType === 'image') {
      return await startFromImage(request, body);
    }

    const mode = body.mode ?? 'factcheck';
    const useMock = process.env.USE_MOCK === 'true' || body.mock === true;

    if (useMock) {
      const events = await loadMockEvents(
        mode === 'scriptcheck' ? 'script-events-demo.json' : 'events-demo.json',
      );
      return streamResponse(request, replayEvents(events));
    }

    if (body.demoId) {
      const demo = await loadDemoCase(body.demoId);
      if (!demo) {
        return fail(404, 'demo_not_found', `找不到演示卷宗：${body.demoId}`);
      }
      return streamResponse(request, replayEvents(caseFileToEvents(demo, DEMO_REPLAY_MS)));
    }

    if (text) {
      const demo = await findDemoCaseByInput(text);
      if (demo) {
        return streamResponse(request, replayEvents(caseFileToEvents(demo, DEMO_REPLAY_MS)));
      }
    }

    if (text.length < MIN_TEXT || text.length > MAX_TEXT) {
      return fail(400, 'invalid_text', `text 长度需在 ${MIN_TEXT}–${MAX_TEXT} 字之间`);
    }

    return streamResponse(request, async (emit, signal) => {
      await runInvestigation(text, emit, { signal, mode });
    });
  } catch (error) {
    return fail(500, 'server_error', messageOf(error));
  }
}

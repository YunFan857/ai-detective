/**
 * 拆疑点接口：返回预览，前端勾选后再带 previewId 立案。
 * 当前阶段只支持文本；链接 / 图片解析等 intake 接入后再放开。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { previewClaims } from '../../../lib/pipeline';
import { findDemoPreviewByInput } from '../../../lib/case-store';
import {
  ClaimsPreviewSchema,
  InputTypeSchema,
  ModeSchema,
  type ClaimsPreview,
  type Mode,
} from '../../../types/case';

// Cache Components 下不允许 runtime / dynamic 段配置：默认即为 Node.js 运行时、按请求执行。

const MIN_TEXT: Record<Mode, number> = { factcheck: 4, scriptcheck: 50 };
const MAX_TEXT: Record<Mode, number> = { factcheck: 500, scriptcheck: 1500 };

const BodySchema = z.object({
  mode: ModeSchema.optional(),
  inputType: InputTypeSchema.optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  image: z.string().optional(),
});

function fail(status: number, error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** mock 预览：按模式读取固定文件，保证演示现场稳定。 */
async function loadMockPreview(mode: Mode): Promise<ClaimsPreview> {
  const name = mode === 'scriptcheck' ? 'claims-preview-script.json' : 'claims-preview-short.json';
  const raw: unknown = JSON.parse(
    await readFile(path.join(process.cwd(), 'mock', name), 'utf8'),
  );
  return ClaimsPreviewSchema.parse(raw);
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
    return fail(400, 'invalid_body', '请求参数不合法（mode / inputType / text 等）');
  }

  const body = parsed.data;
  const mode: Mode = body.mode ?? 'factcheck';
  const inputType = body.inputType ?? 'text';

  if (inputType !== 'text') {
    return fail(501, 'unsupported_input_type', '当前阶段仅支持文本输入，链接 / 图片解析尚未接入');
  }

  const text = body.text?.trim() ?? '';
  if (text.length < MIN_TEXT[mode] || text.length > MAX_TEXT[mode]) {
    return fail(
      400,
      'invalid_text',
      `text 长度需在 ${MIN_TEXT[mode]}–${MAX_TEXT[mode]} 字之间（模式 ${mode}）`,
    );
  }

  try {
    if (process.env.USE_MOCK === 'true') {
      // 演示模式优先用 cache 里的预热预览，断网也能完成「拆疑点 → 立案」两步。
      const demo = await findDemoPreviewByInput(text);
      return NextResponse.json(demo ?? (await loadMockPreview(mode)));
    }

    const preview = await previewClaims(text, { mode, inputType: 'text' });
    return NextResponse.json(preview);
  } catch (error) {
    return fail(500, 'extract_failed', messageOf(error));
  }
}

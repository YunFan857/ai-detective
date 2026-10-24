/**
 * 拆疑点接口：返回预览，前端勾选后再带 previewId 立案。
 * 支持文本与图片输入；图片先经视觉模型转写，再按文本拆疑点。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { InvalidImageError, VisionUnavailableError } from '../../../lib/llm';
import { previewClaims } from '../../../lib/pipeline';
import { extractImageIntake, ImageTextMissingError } from '../../../lib/pipeline/intake';
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
  const useMock = process.env.USE_MOCK === 'true';

  if (inputType !== 'text' && inputType !== 'image') {
    return fail(501, 'unsupported_input_type', '当前阶段仅支持文本与图片输入，链接解析尚未接入');
  }

  // 图片先转写再拆疑点；识别失败 / 未部署分别返回 4xx 与 501。
  if (inputType === 'image') {
    try {
      if (useMock) {
        return NextResponse.json(await loadMockPreview(mode));
      }
      const image = body.image?.trim();
      if (!image) {
        return fail(400, 'invalid_image', '缺少图片数据');
      }
      const intake = await extractImageIntake(image, { signal: request.signal });
      const preview = await previewClaims(intake.input, { mode, inputType: 'image' });
      return NextResponse.json(preview);
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
      return fail(500, 'extract_failed', messageOf(error));
    }
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
    if (useMock) {
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

/**
 * 图片立案入口：先用视觉模型转写截图文字并提取画面线索，
 * 再把结果拼成待查文本交给现有查证流水线。
 */
import { z } from 'zod';
import { chatVisionJSON } from '../llm';

/** 转写文本上限：保留核心说法，避免提示词与检索词被长截图带偏。 */
const MAX_INPUT_CHARS = 800;
/** 画面线索最多保留条数。 */
const MAX_CLUES = 6;

const VisionResultSchema = z.object({
  text: z.string(),
  clues: z.array(z.string()).optional(),
});

/** 截图里没有可核查文字：属于识别失败，不是服务不可用。 */
export class ImageTextMissingError extends Error {
  constructor(message = '没有从截图里读到可核查的文字') {
    super(message);
    this.name = 'ImageTextMissingError';
  }
}

export type ImageIntake = {
  /** 拼上画面线索后送入流水线的待查文本。 */
  input: string;
  /** 单列出来的画面线索，便于排查与后续展示。 */
  clues: string[];
};

const SYSTEM_PROMPT = `你是事实核查编辑的取图助手，只做转写和观察，不做判断。
1. 逐字转写图片中所有可辨认文字，保留原文顺序、标点、数字、emoji、@用户名和转发痕迹；不要总结、改写或补充图片里没有的内容。文字被裁切或看不清时用「…」标记。
2. 列出有助于判断真伪的视觉线索，例如平台界面与水印、头像昵称、发布时间、点赞转发数、图表关键数字、拼接或遮挡痕迹；没有就给空数组。
只输出 JSON：{"text":"转写文字","clues":["线索1","线索2"]}。`;

/**
 * 读取截图并转写为待查文本。
 * 未配置视觉模型时抛 VisionUnavailableError；图片非法时抛 InvalidImageError。
 */
export async function extractImageIntake(
  image: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ImageIntake> {
  const result = await chatVisionJSON({
    system: SYSTEM_PROMPT,
    user: '请转写这张截图里的全部文字，并列出画面线索。',
    image,
    schema: VisionResultSchema,
    temperature: 0.1,
    maxTokens: 2_000,
    timeoutMs: 60_000,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  const text = result.text.replace(/\r\n/g, '\n').trim();
  if (!text) {
    throw new ImageTextMissingError();
  }

  const clues = (result.clues ?? [])
    .map((clue) => clue.replace(/\s+/g, ' ').trim())
    .filter((clue) => clue.length > 0)
    .slice(0, MAX_CLUES);

  const clipped = text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}…` : text;
  const input = clues.length > 0 ? `${clipped}\n\n【画面线索】${clues.join('；')}` : clipped;

  return { input, clues };
}

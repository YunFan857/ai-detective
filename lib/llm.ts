/**
 * 大模型调用唯一入口。
 * 所有大模型请求都必须经过本文件，禁止在业务代码里直接实例化 SDK。
 */
import OpenAI, { APIConnectionTimeoutError, BadRequestError } from 'openai';
import type { ZodError, ZodType } from 'zod';

/** 全局调用统计，随进程生命周期累计 */
export const llmStats = { calls: 0, tokens: 0 };

const DEFAULT_TIMEOUT_MS = 20_000;
/** 视觉模型单次调用给足转写时间。 */
const DEFAULT_VISION_TIMEOUT_MS = 60_000;
/** 图片 data URL 上限，避免把超大截图塞进模型请求。 */
const MAX_IMAGE_DATA_URL_LENGTH = 12 * 1024 * 1024;
/** 统一采样温度：0.2 兼顾事实任务的稳定性与表达自然度。 */
const DEFAULT_TEMPERATURE = 0.2;
/** 默认输出上限；各阶段可按需要覆盖。 */
const DEFAULT_MAX_TOKENS = 4_000;
const MAX_VALIDATION_RETRIES = 2;
/** 空正文重试时的输出预算上限。 */
const MAX_OUTPUT_BUDGET = 8_000;
const EMPTY_CONTENT = '模型返回内容为空';
const DEFAULT_EMBEDDING_BATCH_SIZE = 64;
const JSON_ONLY_INSTRUCTION =
  '你必须只输出一个合法的 JSON 对象，不要输出 Markdown 代码块、注释或任何解释性文字。';

export class LlmError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LlmError';
    this.cause = cause;
  }
}

/** 未配置视觉模型：图片查证能力尚未部署，不应伪装成识别失败。 */
export class VisionUnavailableError extends LlmError {
  constructor(message = '图片查证能力尚未部署') {
    super(message);
    this.name = 'VisionUnavailableError';
  }
}

/** 前端传来的图片不是可用的 data URL / base64。 */
export class InvalidImageError extends LlmError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

export type ChatJsonOptions<T> = {
  system: string;
  user: string;
  schema: ZodType<T>;
  temperature?: number;
  /** 输出 token 上限；不传时使用全局默认值。 */
  maxTokens?: number;
  timeoutMs?: number;
  /** 外部取消信号；软超时到点时用于中止在途请求。 */
  signal?: AbortSignal;
};

type Runtime = {
  client: OpenAI;
  model: string;
};

let cachedRuntime: { key: string; runtime: Runtime } | null = null;
let cachedEmbeddingRuntime: { key: string; runtime: Runtime } | null = null;
let cachedVisionRuntime: { key: string; runtime: Runtime } | null = null;

function readEnv(name: string, hint: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new LlmError(`${name} 未配置${hint ? `：${hint}` : ''}`);
  }
  return value;
}

function resolveRuntime(): Runtime {
  const baseURL = readEnv('LLM_BASE_URL', '请参考 .env.example 配置');
  const apiKey = readEnv('LLM_API_KEY', '请参考 .env.example 配置');
  const model = readEnv('LLM_MODEL', '请参考 .env.example 配置');
  const key = `${baseURL}\n${apiKey}`;

  if (!cachedRuntime || cachedRuntime.key !== key) {
    cachedRuntime = {
      key,
      runtime: {
        client: new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: DEFAULT_TIMEOUT_MS }),
        model,
      },
    };
  }

  cachedRuntime.runtime.model = model;
  return cachedRuntime.runtime;
}

/**
 * 向量化运行时：优先使用独立的 EMBEDDING_BASE_URL / EMBEDDING_API_KEY，
 * 未配置时回退到 LLM_* 网关，兼容只提供一个网关的环境。
 */
function resolveEmbeddingRuntime(): Runtime {
  const baseURL =
    process.env.EMBEDDING_BASE_URL?.trim() || readEnv('LLM_BASE_URL', '请参考 .env.example 配置');
  const apiKey =
    process.env.EMBEDDING_API_KEY?.trim() || readEnv('LLM_API_KEY', '请参考 .env.example 配置');
  const model = readEnv('EMBEDDING_MODEL', '无法生成向量，上层请降级为关键词匹配');
  const key = `${baseURL}\n${apiKey}`;

  if (!cachedEmbeddingRuntime || cachedEmbeddingRuntime.key !== key) {
    cachedEmbeddingRuntime = {
      key,
      runtime: {
        client: new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: DEFAULT_TIMEOUT_MS }),
        model,
      },
    };
  }

  cachedEmbeddingRuntime.runtime.model = model;
  return cachedEmbeddingRuntime.runtime;
}

/**
 * 视觉运行时：优先独立网关，未配置时复用 LLM_* 网关。
 * 未配置 VISION_MODEL 时直接报「尚未部署」，不拿纯文本模型硬试。
 */
function resolveVisionRuntime(): Runtime {
  const model = process.env.VISION_MODEL?.trim();
  if (!model) {
    throw new VisionUnavailableError();
  }

  const baseURL =
    process.env.VISION_BASE_URL?.trim() || readEnv('LLM_BASE_URL', '请参考 .env.example 配置');
  const apiKey =
    process.env.VISION_API_KEY?.trim() || readEnv('LLM_API_KEY', '请参考 .env.example 配置');
  const key = `${baseURL}\n${apiKey}\n${model}`;

  if (!cachedVisionRuntime || cachedVisionRuntime.key !== key) {
    cachedVisionRuntime = {
      key,
      runtime: {
        client: new OpenAI({
          baseURL,
          apiKey,
          maxRetries: 0,
          timeout: DEFAULT_VISION_TIMEOUT_MS,
        }),
        model,
      },
    };
  }

  return cachedVisionRuntime.runtime;
}

/** 允许的图片 MIME；前端固定传 jpeg，兼容 png / webp / gif。 */
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_MIME_ALIASES: Record<string, string> = { 'image/jpg': 'image/jpeg' };
/** data URL 前缀 + base64 正文；兼容 charset 之类的额外参数。 */
const DATA_URL_PATTERN = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** 用文件头识别图片类型，供裸 base64 兜底时补齐 MIME。 */
function sniffImageMime(bytes: Buffer): string | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  const head = bytes.subarray(0, 4).toString('latin1');
  if (head === '\x89PNG') return 'image/png';
  if (head === 'GIF8') return 'image/gif';
  if (head === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return undefined;
}

/**
 * 统一图片入参：优先接收完整 data URL（自带 MIME），裸 base64 作为兜底。
 * 统一剥离 data:*;base64, 前缀 → 校验 base64 → 按前缀（或文件头）取类型 → 拼成规范 data URL。
 */
export function toImageDataUrl(image: string): string {
  const trimmed = image.trim();
  if (!trimmed) {
    throw new InvalidImageError('图片内容为空');
  }
  if (trimmed.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new InvalidImageError('图片数据过大，请压缩后重试');
  }

  const matched = DATA_URL_PATTERN.exec(trimmed);
  if (!matched && trimmed.toLowerCase().startsWith('data:')) {
    throw new InvalidImageError('图片 data URL 需要使用 base64 编码');
  }

  const rawMime = matched?.[1]?.trim().toLowerCase();
  const declared = rawMime ? (IMAGE_MIME_ALIASES[rawMime] ?? rawMime) : undefined;
  if (declared && !ALLOWED_IMAGE_MIMES.has(declared)) {
    throw new InvalidImageError('图片格式不支持，请上传 jpg / png / webp / gif 截图');
  }

  const payload = (matched ? (matched[2] ?? '') : trimmed).replace(/\s+/g, '');
  if (!BASE64_PATTERN.test(payload)) {
    throw new InvalidImageError('图片数据不是合法的 base64');
  }

  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length === 0) {
    throw new InvalidImageError('图片数据不是合法的 base64');
  }

  // 裸 base64 没有 MIME，靠文件头补齐；识别不出说明不是受支持的图片。
  const mime = declared ?? sniffImageMime(bytes);
  if (!mime) {
    throw new InvalidImageError('无法识别图片格式，请上传 jpg / png / webp / gif 截图');
  }

  return `data:${mime};base64,${payload}`;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof APIConnectionTimeoutError ||
    (error instanceof Error && error.name === 'APIConnectionTimeoutError')
  );
}

/** 部分模型不支持 response_format，需要退回提示词约束 + 文本提取 */
function isJsonModeUnsupported(error: unknown): boolean {
  if (!(error instanceof BadRequestError)) return false;
  return /response_format|json_object|json mode/i.test(error.message);
}

function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/** 提取文本中第一个完整的 JSON 对象（兼容模型加了前后缀或代码块的情况） */
function extractFirstJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // 继续按大括号配对扫描
  }

  const start = trimmed.indexOf('{');
  if (start === -1) {
    throw new LlmError('模型输出中找不到 JSON 对象');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          throw new LlmError('模型输出的 JSON 无法解析');
        }
      }
    }
  }

  throw new LlmError('模型输出的 JSON 不完整');
}

async function requestCompletion(
  messages: ChatMessage[],
  options: {
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    jsonMode: boolean;
    /** 走视觉网关而不是文本网关。 */
    vision?: boolean;
    signal?: AbortSignal;
  },
): Promise<string> {
  const { client, model } = options.vision ? resolveVisionRuntime() : resolveRuntime();
  const response = await client.chat.completions.create(
    {
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      response_format: options.jsonMode ? { type: 'json_object' } : undefined,
    },
    {
      timeout: options.timeoutMs,
      maxRetries: 0,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );

  llmStats.calls += 1;
  llmStats.tokens += response.usage?.total_tokens ?? 0;

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new LlmError(EMPTY_CONTENT);
  }
  return content;
}

/**
 * 结构化调用公共循环：要求模型只输出 JSON，并用 zod 校验。
 * 校验失败会把错误回传给模型重试（最多 2 次）；超时重试 1 次。
 */
async function requestJson<T>(
  messages: ChatMessage[],
  schema: ZodType<T>,
  options: {
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    vision?: boolean;
    signal?: AbortSignal;
  },
): Promise<T> {
  const { temperature, timeoutMs, signal } = options;
  let budget = options.maxTokens;

  let jsonMode = true;
  let timeoutRetried = false;
  let validationRetries = 0;

  for (;;) {
    let raw: string;
    try {
      raw = await requestCompletion(messages, {
        temperature,
        maxTokens: budget,
        timeoutMs,
        jsonMode,
        ...(options.vision ? { vision: true } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (jsonMode && isJsonModeUnsupported(error)) {
        jsonMode = false;
        continue;
      }
      if (!timeoutRetried && isTimeoutError(error)) {
        timeoutRetried = true;
        continue;
      }
      // 推理型模型的思维链会占用输出预算，预算打满时正文可能为空；放大预算重试一次。
      if (
        error instanceof LlmError &&
        error.message === EMPTY_CONTENT &&
        budget < MAX_OUTPUT_BUDGET
      ) {
        budget = Math.min(budget * 2, MAX_OUTPUT_BUDGET);
        continue;
      }
      throw error instanceof LlmError ? error : new LlmError('大模型调用失败', error);
    }

    let parsed: unknown;
    try {
      parsed = extractFirstJson(raw);
    } catch (error) {
      if (validationRetries >= MAX_VALIDATION_RETRIES) {
        throw error;
      }
      validationRetries += 1;
      messages.push(
        { role: 'assistant', content: raw },
        {
          role: 'user',
          content: `上面的输出不是合法 JSON（${(error as Error).message}）。请重新输出一个完整的 JSON 对象。`,
        },
      );
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    if (validationRetries >= MAX_VALIDATION_RETRIES) {
      throw new LlmError(`模型输出未通过 zod 校验：${formatIssues(result.error)}`);
    }
    validationRetries += 1;
    messages.push(
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `上面的 JSON 未通过校验：${formatIssues(result.error)}。请修正后重新输出完整的 JSON 对象。`,
      },
    );
  }
}

/** 纯文本结构化调用。 */
export async function chatJSON<T>(options: ChatJsonOptions<T>): Promise<T> {
  const {
    system,
    user,
    schema,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = options;

  const messages: ChatMessage[] = [
    { role: 'system', content: `${system}\n\n${JSON_ONLY_INSTRUCTION}` },
    { role: 'user', content: user },
  ];

  return requestJson(messages, schema, {
    temperature,
    maxTokens,
    timeoutMs,
    ...(signal ? { signal } : {}),
  });
}

export type ChatVisionOptions<T> = {
  system: string;
  user: string;
  /** data URL 或裸 base64；内部会统一成 data URL。 */
  image: string;
  schema: ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * 视觉结构化调用：把截图放到多模态 content 里，再按 JSON 校验。
 * 未配置 VISION_MODEL 时抛 VisionUnavailableError。
 */
export async function chatVisionJSON<T>(options: ChatVisionOptions<T>): Promise<T> {
  const {
    system,
    user,
    image,
    schema,
    temperature = 0.1,
    maxTokens = 2_000,
    timeoutMs = DEFAULT_VISION_TIMEOUT_MS,
    signal,
  } = options;

  const imageUrl = toImageDataUrl(image);
  const content: ChatContentPart[] = [
    { type: 'text', text: user },
    { type: 'image_url', image_url: { url: imageUrl } },
  ];
  const messages: ChatMessage[] = [
    { role: 'system', content: `${system}\n\n${JSON_ONLY_INSTRUCTION}` },
    { role: 'user', content },
  ];

  return requestJson(messages, schema, {
    temperature,
    maxTokens,
    timeoutMs,
    vision: true,
    ...(signal ? { signal } : {}),
  });
}

/**
 * 向量化：默认每次最多 64 条，可用 EMBEDDING_BATCH_SIZE 调整。
 * 未配置 EMBEDDING_MODEL 时抛出 LlmError，方便上层降级为关键词匹配。
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const { client, model } = resolveEmbeddingRuntime();
  const vectors: number[][] = [];
  const configured = Number(process.env.EMBEDDING_BATCH_SIZE);
  const batchSize =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_EMBEDDING_BATCH_SIZE;

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const response = await client.embeddings.create(
      // 部分网关只接受 float，SDK 默认的 base64 会被 400 拒绝
      { model, input: batch, encoding_format: 'float' },
      { timeout: DEFAULT_TIMEOUT_MS, maxRetries: 0 },
    );

    llmStats.calls += 1;
    llmStats.tokens += response.usage?.total_tokens ?? 0;

    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) {
      vectors.push(item.embedding);
    }
  }

  return vectors;
}

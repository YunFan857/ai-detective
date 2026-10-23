/**
 * 大模型调用唯一入口。
 * 所有大模型请求都必须经过本文件，禁止在业务代码里直接实例化 SDK。
 */
import OpenAI, { APIConnectionTimeoutError, BadRequestError } from 'openai';
import type { ZodError, ZodType } from 'zod';

/** 全局调用统计，随进程生命周期累计 */
export const llmStats = { calls: 0, tokens: 0 };

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_VALIDATION_RETRIES = 2;
const EMBEDDING_BATCH_SIZE = 32;
const JSON_ONLY_INSTRUCTION =
  '你必须只输出一个合法的 JSON 对象，不要输出 Markdown 代码块、注释或任何解释性文字。';

export class LlmError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LlmError';
    this.cause = cause;
  }
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatJsonOptions<T> = {
  system: string;
  user: string;
  schema: ZodType<T>;
  temperature?: number;
  timeoutMs?: number;
};

type Runtime = {
  client: OpenAI;
  model: string;
};

let cachedRuntime: { key: string; runtime: Runtime } | null = null;

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
  options: { temperature: number; timeoutMs: number; jsonMode: boolean },
): Promise<string> {
  const { client, model } = resolveRuntime();
  const response = await client.chat.completions.create(
    {
      model,
      messages,
      temperature: options.temperature,
      response_format: options.jsonMode ? { type: 'json_object' } : undefined,
    },
    { timeout: options.timeoutMs, maxRetries: 0 },
  );

  llmStats.calls += 1;
  llmStats.tokens += response.usage?.total_tokens ?? 0;

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new LlmError('模型返回内容为空');
  }
  return content;
}

/**
 * 结构化调用：要求模型只输出 JSON，并用 zod 校验。
 * 校验失败会把错误回传给模型重试（最多 2 次）；超时重试 1 次。
 */
export async function chatJSON<T>(options: ChatJsonOptions<T>): Promise<T> {
  const { system, user, schema, temperature = 0.2, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const messages: ChatMessage[] = [
    { role: 'system', content: `${system}\n\n${JSON_ONLY_INSTRUCTION}` },
    { role: 'user', content: user },
  ];

  let jsonMode = true;
  let timeoutRetried = false;
  let validationRetries = 0;

  for (;;) {
    let raw: string;
    try {
      raw = await requestCompletion(messages, { temperature, timeoutMs, jsonMode });
    } catch (error) {
      if (jsonMode && isJsonModeUnsupported(error)) {
        jsonMode = false;
        continue;
      }
      if (!timeoutRetried && isTimeoutError(error)) {
        timeoutRetried = true;
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

/**
 * 向量化：每次最多 32 条。
 * 未配置 EMBEDDING_MODEL 时抛出 LlmError，方便上层降级为关键词匹配。
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const model = readEnv('EMBEDDING_MODEL', '无法生成向量，上层请降级为关键词匹配');
  const { client } = resolveRuntime();
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
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

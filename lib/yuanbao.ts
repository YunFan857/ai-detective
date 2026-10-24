/**
 * 元宝搜索唯一入口。
 * 所有搜索请求都必须经过本文件，单案搜索次数上限 10 次。
 * 接口文档：https://cloud.tencent.com/document/product/1806/121811
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';

export type SearchResult = {
  url: string;
  site: string;
  title: string;
  snippet: string;
  /** 内容发布时间，ISO 8601；接口未返回或无法解析时省略 */
  publishedAt?: string;
};

export type SearchOptions = {
  cnt?: number;
  signal?: AbortSignal;
};

export type SearchBudget = {
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  used: () => number;
  remaining: () => number;
};

export const searchStats = { calls: 0, cacheHits: 0 };

const DEFAULT_API_URL = 'https://api.wsa.cloud.tencent.com/SearchPro';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CONCURRENCY = 3;
const CACHE_DIR = path.join(process.cwd(), '.cache', 'search');
const concurrency = pLimit(MAX_CONCURRENCY);

const BUSINESS_ERROR_MESSAGES: Record<string, string> = {
  UnauthorizedOperation: '元宝搜索鉴权失败：请检查 YUANBAO_API_KEY 是否正确、是否已被删除',
  ResourceNotFound: '元宝搜索服务未开通：请先在腾讯云元宝搜索控制台开通服务',
  ResourceUnavailable: '元宝搜索服务不可用：请检查账号是否欠费',
  RequestLimitExceeded: '元宝搜索请求超限：已触发频率限制，请稍后重试',
};

export class YuanbaoError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false, cause?: unknown) {
    super(message);
    this.name = 'YuanbaoError';
    this.retryable = retryable;
    this.cause = cause;
  }
}

type YuanbaoConfig = {
  url: string;
  apiKey: string;
};

function readConfig(): YuanbaoConfig {
  const url = process.env.YUANBAO_API_URL?.trim() || DEFAULT_API_URL;
  const apiKey = process.env.YUANBAO_API_KEY?.trim();
  if (!apiKey) {
    throw new YuanbaoError(
      '缺少 YUANBAO_API_KEY：请在腾讯云元宝搜索控制台（概览 → 服务 API KEY 方式）创建 API KEY，并写入 .env.local',
    );
  }
  return { url, apiKey };
}

function cacheFile(query: string, cnt: number | undefined): string {
  const hash = createHash('sha1')
    .update(`${query}\u0000${cnt ?? ''}`)
    .digest('hex');
  return path.join(CACHE_DIR, `${hash}.json`);
}

type CacheFile = {
  query: string;
  cnt: number | null;
  savedAt: string;
  results: SearchResult[];
};

function isSearchResult(value: unknown): value is SearchResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.url === 'string' &&
    typeof item.site === 'string' &&
    typeof item.title === 'string' &&
    typeof item.snippet === 'string' &&
    (item.publishedAt === undefined || typeof item.publishedAt === 'string')
  );
}

async function readCache(file: string): Promise<SearchResult[] | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const data = parsed as Partial<CacheFile>;
    if (!Array.isArray(data.results) || !data.results.every(isSearchResult)) {
      return null;
    }
    return data.results.map(normalizeResult);
  } catch {
    return null;
  }
}

async function writeCache(
  file: string,
  query: string,
  cnt: number | undefined,
  results: SearchResult[],
): Promise<void> {
  const data: CacheFile = {
    query,
    cnt: cnt ?? null,
    savedAt: new Date().toISOString(),
    results,
  };
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // 缓存写失败不影响本次结果
  }
}

function toIsoString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  // 接口返回形如 "2025/02/26 09:37:00" 或 "2024-06-07 19:00:51"
  const date = new Date(trimmed.replace(/\//g, '-'));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 折叠连续空白并去掉首尾空白，避免接口返回的换行撑破卡片布局。 */
function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** 站点名缺失时用域名兜底，去掉 www. 前缀。 */
function siteFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** 统一来源字段：站点兜底、文本归一化；缓存与实时结果都走这里。 */
function normalizeResult(result: SearchResult): SearchResult {
  return {
    url: result.url,
    site: normalizeText(result.site) || siteFromUrl(result.url),
    title: normalizeText(result.title),
    snippet: normalizeText(result.snippet),
    ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
  };
}

function parsePage(raw: unknown): SearchResult | null {
  let page: unknown = raw;
  if (typeof raw === 'string') {
    try {
      page = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof page !== 'object' || page === null) {
    return null;
  }

  const item = page as Record<string, unknown>;
  if (typeof item.url !== 'string' || !item.url) {
    return null;
  }

  return normalizeResult({
    url: item.url,
    site: typeof item.site === 'string' ? item.site : '',
    title: typeof item.title === 'string' ? item.title : '',
    snippet:
      typeof item.passage === 'string'
        ? item.passage
        : typeof item.content === 'string'
          ? item.content
          : '',
    publishedAt: toIsoString(item.date),
  });
}

type RawSearchResponse = {
  Response?: {
    Pages?: unknown;
    Error?: { Code?: unknown; Message?: unknown };
  };
};

function parsePayload(payload: unknown): RawSearchResponse {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }
  return payload as RawSearchResponse;
}

function businessError(code: string, message: unknown): YuanbaoError {
  const mapped = BUSINESS_ERROR_MESSAGES[code];
  if (mapped) {
    return new YuanbaoError(mapped);
  }
  const detail = typeof message === 'string' && message ? `：${message}` : '';
  return new YuanbaoError(`元宝搜索失败（${code}）${detail}`);
}

async function requestOnce(
  query: string,
  cnt: number | undefined,
  config: YuanbaoConfig,
  callerSignal?: AbortSignal,
): Promise<SearchResult[]> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  callerSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    searchStats.calls += 1;
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ Query: query, ...(cnt ? { Cnt: cnt } : {}) }),
      signal: controller.signal,
    });

    const payload = parsePayload(await response.json());

    if (callerSignal?.aborted) {
      throw new YuanbaoError('元宝搜索已取消');
    }

    const errorInfo = payload.Response?.Error;
    if (typeof errorInfo?.Code === 'string') {
      throw businessError(errorInfo.Code, errorInfo.Message);
    }

    if (!response.ok) {
      throw new YuanbaoError(`元宝搜索 HTTP ${response.status}`, response.status >= 500);
    }

    const pages = payload.Response?.Pages;
    if (!Array.isArray(pages)) {
      return [];
    }

    return pages.map(parsePage).filter((item): item is SearchResult => item !== null);
  } catch (error) {
    if (error instanceof YuanbaoError) {
      throw error;
    }
    if (timedOut) {
      throw new YuanbaoError('元宝搜索超时（10 秒）', true, error);
    }
    if (callerSignal?.aborted) {
      throw new YuanbaoError('元宝搜索已取消', false, error);
    }
    throw new YuanbaoError(`元宝搜索网络错误：${(error as Error).message}`, true, error);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onAbort);
  }
}

async function requestWithRetry(
  query: string,
  cnt: number | undefined,
  config: YuanbaoConfig,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  try {
    return await requestOnce(query, cnt, config, signal);
  } catch (error) {
    if (!(error instanceof YuanbaoError) || !error.retryable || signal?.aborted) {
      throw error;
    }
    return requestOnce(query, cnt, config, signal);
  }
}

/** 搜索一次；命中本地缓存时不计费。 */
export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  const config = readConfig();
  const file = cacheFile(query, options.cnt);

  const cached = await readCache(file);
  if (cached) {
    searchStats.cacheHits += 1;
    return cached;
  }

  const results = await concurrency(() =>
    requestWithRetry(query, options.cnt, config, options.signal),
  );
  await writeCache(file, query, options.cnt, results);
  return results;
}

/** 每案搜索预算：达到上限后不再发请求，直接返回空数组。 */
export function createSearchBudget(limit = 10): SearchBudget {
  let used = 0;

  return {
    search: async (query, options) => {
      if (used >= limit) {
        return [];
      }
      used += 1;
      return search(query, options);
    },
    used: () => used,
    remaining: () => Math.max(limit - used, 0),
  };
}

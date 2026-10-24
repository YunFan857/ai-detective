/**
 * 向量化连通性诊断：确认网关是否支持 encoding_format、返回是否为 number[] 及维度。
 * 运行：pnpm tsx scripts/test-embedding.ts
 */
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { embed } from '../lib/llm';

dotenv.config({ path: '.env.local' });
dotenv.config();

const model = process.env.EMBEDDING_MODEL?.trim() ?? '';
const embeddingBase = process.env.EMBEDDING_BASE_URL?.trim() ?? '';
const baseURL = embeddingBase || process.env.LLM_BASE_URL?.trim() || '';
const apiKey =
  process.env.EMBEDDING_API_KEY?.trim() || process.env.LLM_API_KEY?.trim() || '';

/** 只保留协议与域名，避免把路径或密钥打进日志。 */
function maskBase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '(无效地址)';
  }
}

function describeEmbedding(value: unknown): string {
  if (!Array.isArray(value)) {
    return `不是数组（typeof ${typeof value}）`;
  }
  const allNumbers = value.every((item) => typeof item === 'number');
  return `数组长度 ${value.length}，元素全为 number=${allNumbers}`;
}

async function probe(label: string, encodingFormat?: 'float'): Promise<void> {
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: 20_000 });
  try {
    const response = await client.embeddings.create({
      model,
      input: ['咖啡会致癌吗？', '喝咖啡与肿瘤风险'],
      ...(encodingFormat ? { encoding_format: encodingFormat } : {}),
    });
    const [first] = response.data;
    console.log(`✓ ${label}：${describeEmbedding(first?.embedding)}`);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 'unknown';
    const body = (error as { error?: unknown }).error ?? (error as Error).message;
    console.log(`✗ ${label}：status=${status} body=${JSON.stringify(body).slice(0, 400)}`);
  }
}

async function main(): Promise<void> {
  console.log(`EMBEDDING_MODEL=${model || '(未配置)'}`);
  console.log(
    `EMBEDDING_BASE_URL=${embeddingBase ? maskBase(embeddingBase) : '(未配置，回退 LLM_BASE_URL)'}`,
  );
  console.log(`实际请求地址=${maskBase(baseURL)}`);
  console.log('');

  await probe('不传 encoding_format');
  await probe('encoding_format=float', 'float');

  console.log('');
  try {
    const [vector] = await embed(['咖啡会致癌吗？']);
    console.log(`✓ lib/llm.embed()：${describeEmbedding(vector)}`);
  } catch (error) {
    console.log(`✗ lib/llm.embed()：${(error as Error).message}`);
    process.exitCode = 1;
  }
}

void main();

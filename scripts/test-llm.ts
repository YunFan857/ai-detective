import 'dotenv/config';
import { z } from 'zod';
import { chatJSON, llmStats } from '../lib/llm';

const ResultSchema = z.object({ ok: z.literal(true) });

async function main(): Promise<void> {
  const startedAt = Date.now();

  try {
    const result = await chatJSON({
      system: '你是一个用于连通性测试的助手。',
      user: '请返回 {"ok": true}，不要输出其他内容。',
      schema: ResultSchema,
      temperature: 0,
    });

    console.log('结果:', result);
    console.log(`耗时: ${Date.now() - startedAt}ms`);
    console.log(`累计调用: ${llmStats.calls} 次，tokens: ${llmStats.tokens}`);
  } catch (error) {
    console.error('调用失败:', error);
    process.exitCode = 1;
  }
}

void main();

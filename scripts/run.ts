import dotenv from 'dotenv';
import { llmStats } from '../lib/llm';
import { extractClaims } from '../lib/pipeline/claims';
import { gatherEvidence } from '../lib/pipeline/search';
import { searchStats } from '../lib/yuanbao';
import type { Source } from '../types/case';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main(): Promise<void> {
  const input = process.argv.slice(2).join(' ').trim();
  if (!input) {
    console.error('用法: pnpm run:case "要核查的消息"');
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const claims = await extractClaims(input);

  console.log(`输入: ${input}`);
  console.log(`疑点: ${claims.length} 条`);
  for (const claim of claims) {
    console.log(`- ${claim.id} [${claim.kind}] ${claim.text}`);
  }

  const sources: Source[] = [];
  const errors: string[] = [];
  await gatherEvidence(claims, (event) => {
    if (event.type === 'source') {
      sources.push(event.source);
    } else if (event.type === 'error') {
      errors.push(event.message);
    }
  });

  console.log(
    `来源: ${sources.length} 条（模型调用 ${llmStats.calls} 次，搜索 ${searchStats.calls} 次，缓存命中 ${searchStats.cacheHits} 次）`,
  );
  for (const claim of claims) {
    const own = sources.filter((source) => source.claimId === claim.id);
    const pro = own.filter((source) => source.direction === 'pro').length;
    const con = own.filter((source) => source.direction === 'con').length;
    console.log(`- ${claim.id} pro ${pro} 条 / con ${con} 条，保留 ${own.length} 条`);
  }
  for (const message of errors) {
    console.log(`! ${message}`);
  }
  console.log(`耗时: ${Date.now() - startedAt}ms`);
}

main().catch((error: unknown) => {
  console.error('调查失败:', error);
  process.exitCode = 1;
});

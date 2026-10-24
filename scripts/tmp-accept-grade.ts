import dotenv from 'dotenv';
import { llmStats } from '../lib/llm';
import { extractClaims } from '../lib/pipeline/claims';
import { gatherEvidence } from '../lib/pipeline/search';
import { gradeSources } from '../lib/pipeline/grade';
import { searchStats } from '../lib/yuanbao';
import type { CaseEvent, Source } from '../types/case';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main(): Promise<void> {
  const input = process.argv.slice(2).join(' ').trim();
  if (!input) {
    console.error('用法: pnpm exec tsx scripts/tmp-accept-grade.ts "要核查的消息"');
    process.exitCode = 1;
    return;
  }

  const claims = await extractClaims(input);
  console.log(`输入: ${input}`);
  console.log('疑点:');
  for (const claim of claims) {
    console.log(`- ${claim.id} [${claim.kind}] ${claim.text}`);
  }

  const sources: Source[] = [];
  const errors: string[] = [];
  await gatherEvidence(claims, (event: CaseEvent) => {
    if (event.type === 'source') {
      sources.push(event.source);
    } else if (event.type === 'error') {
      errors.push(event.message);
    }
  });

  const graded = await gradeSources(claims, sources, (event: CaseEvent) => {
    if (event.type === 'error') {
      errors.push(event.message);
    }
  });

  console.log(
    `\n来源 ${graded.length} 条（搜索 ${searchStats.calls} 次，缓存命中 ${searchStats.cacheHits} 次）`,
  );
  for (const claim of claims) {
    console.log(`\n## ${claim.id} ${claim.text}`);
    for (const source of graded.filter((item) => item.claimId === claim.id)) {
      console.log(
        [
          source.id.padEnd(4),
          String(source.tier ?? '-').padEnd(10),
          String(source.stance ?? '-').padEnd(10),
          source.direction.padEnd(3),
          source.site,
          '|',
          source.title,
          '|',
          source.url,
        ].join(' '),
      );
    }
  }

  console.log(`\nLLM 调用 ${llmStats.calls} 次，tokens ${llmStats.tokens}`);
  if (errors.length > 0) {
    console.log('降级事件:');
    for (const message of errors) {
      console.log(`! ${message}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error('验收失败:', error);
  process.exitCode = 1;
});

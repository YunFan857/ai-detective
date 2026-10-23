import dotenv from 'dotenv';
import { llmStats } from '../lib/llm';
import { extractClaims } from '../lib/pipeline/claims';
import { gatherEvidence, type ClaimQueryPlan } from '../lib/pipeline/search';
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
  const notes: string[] = [];
  const plans = new Map<string, ClaimQueryPlan>();

  await gatherEvidence(
    claims,
    (event) => {
      if (event.type === 'source') {
        sources.push(event.source);
      } else if (event.type === 'error') {
        errors.push(event.message);
      } else if (event.type === 'stage') {
        notes.push(event.message);
      }
    },
    { onPlan: (plan) => plans.set(plan.claimId, plan) },
  );

  console.log('\n检索词与来源:');
  let totalExecuted = 0;
  for (const claim of claims) {
    const own = sources.filter((source) => source.claimId === claim.id);
    const proSources = own.filter((source) => source.direction === 'pro').length;
    const conSources = own.filter((source) => source.direction === 'con').length;
    const plan = plans.get(claim.id);
    const status = plan?.fallback ? '已兜底' : plan?.repaired ? '已修复' : '正常';

    console.log(`- ${claim.id} ${claim.text}`);
    console.log(`  pro 检索词: ${plan ? plan.pro.join(' | ') : '（缺失）'}`);
    console.log(`  con 检索词: ${plan ? plan.con.join(' | ') : '（缺失）'}`);
    console.log(
      `  pro 来源 ${proSources} 条 / con 来源 ${conSources} 条 / 保留 ${own.length} 条 / 执行 ${plan?.executed ?? 0} 次 / ${status}`,
    );
    totalExecuted += plan?.executed ?? 0;
  }

  console.log(
    `\n来源合计: ${sources.length} 条（模型调用 ${llmStats.calls} 次，搜索执行 ${totalExecuted} 次，接口请求 ${searchStats.calls} 次，缓存命中 ${searchStats.cacheHits} 次）`,
  );
  for (const message of notes) {
    console.log(`> ${message}`);
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

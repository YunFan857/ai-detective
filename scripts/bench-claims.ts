/**
 * 疑点数耗时基准：固定 6 个互不相关的疑点，按 1 / 3 / 6 个依次立案，
 * 输出各阶段耗时、软超时与退款情况。
 *
 * 运行前先清空搜索缓存，避免跨轮命中：
 *   mv .cache/search /tmp/search-bench-1
 *   USE_MOCK=false LLM_MODEL=deepseek/deepseek-flash pnpm exec tsx scripts/bench-claims.ts --claims 1
 */
import dotenv from 'dotenv';
import { runInvestigation } from '../lib/pipeline';
import type { CaseEvent, Claim, Stage } from '../types/case';

dotenv.config({ path: '.env.local' });
dotenv.config();

const INPUT =
  '网传喝咖啡会致癌，每天一杯风险增加 30%；隔夜菜会产生亚硝酸盐；味精加热后会致癌；' +
  '微波炉加热食物会流失营养；空腹吃香蕉会伤胃；每天走一万步是世卫组织建议。';

const CLAIMS: Claim[] = [
  { id: 'c1', text: '喝咖啡会致癌，每天一杯风险增加30%', kind: 'causal' },
  { id: 'c2', text: '隔夜菜会产生亚硝酸盐', kind: 'causal' },
  { id: 'c3', text: '味精加热后会致癌', kind: 'causal' },
  { id: 'c4', text: '微波炉加热食物会流失营养', kind: 'causal' },
  { id: 'c5', text: '空腹吃香蕉会伤胃', kind: 'causal' },
  { id: 'c6', text: '每天走一万步是世卫组织建议', kind: 'number' },
];

function claimCount(): number {
  const index = process.argv.indexOf('--claims');
  const raw = index >= 0 ? Number(process.argv[index + 1]) : 1;
  if (!Number.isInteger(raw) || raw < 1 || raw > CLAIMS.length) {
    throw new Error(`--claims 需为 1–${CLAIMS.length} 的整数`);
  }
  return raw;
}

async function main(): Promise<void> {
  const count = claimCount();
  const selected = CLAIMS.slice(0, count);
  const startedAt = Date.now();
  const stageStartedAt = new Map<Stage, number>();
  const timings: { stage: Stage; ms: number }[] = [];
  let timedOut = false;
  let sources = 0;
  let verdictSummary = '';
  let billing = '';

  const caseFile = await runInvestigation(
    INPUT,
    (event: CaseEvent) => {
      if (event.type === 'stage') {
        if (event.status === 'start') {
          stageStartedAt.set(event.stage, Date.now());
        } else {
          const began = stageStartedAt.get(event.stage);
          if (began !== undefined) {
            timings.push({ stage: event.stage, ms: Date.now() - began });
            stageStartedAt.delete(event.stage);
          }
        }
        if (event.message.includes('时间有限')) timedOut = true;
      }
      if (event.type === 'source') sources += 1;
      if (event.type === 'verdict') verdictSummary = event.verdict.summary;
      if (event.type === 'billing') {
        billing = `${event.billing.charged}/${event.billing.refunded}`;
      }
    },
    { claims: CLAIMS, selectedClaimIds: selected.map((claim) => claim.id) },
  );

  console.log(
    JSON.stringify({
      claims: selected.length,
      totalMs: Date.now() - startedAt,
      stages: Object.fromEntries(timings.map((item) => [item.stage, item.ms])),
      timedOut,
      sources,
      chargeRefund: billing,
      summaries: caseFile.verdict?.claims.map((item) => `${item.claimId}:${item.level}`) ?? [],
      verdictSummary,
    }),
  );
}

main().catch((error: unknown) => {
  console.error('基准执行失败:', error);
  process.exitCode = 1;
});

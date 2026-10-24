import dotenv from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runInvestigation } from '../lib/pipeline';
import { getExecutedSearchPlan } from '../lib/pipeline/search';
import {
  ClaimsPreviewSchema,
  type CaseEvent,
  type Claim,
  type ClaimsPreview,
  type Mode,
  type Source,
  type Verdict,
} from '../types/case';

dotenv.config({ path: '.env.local' });
dotenv.config();

type ParsedArgs = {
  text: string;
  flags: Map<string, string>;
};

const USAGE =
  '用法: pnpm run:case "要核查的消息" [--mode script] [--preview <previewId>] [--select c1,c3] [--save-as name]';

function parseArgs(argv: string[]): ParsedArgs {
  const words: string[] = [];
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      words.push(item);
      continue;
    }

    const separator = item.indexOf('=');
    if (separator > 0) {
      flags.set(item.slice(2, separator), item.slice(separator + 1));
      continue;
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, '');
    }
  }

  return { text: words.join(' ').trim(), flags };
}

function resolveMode(value: string | undefined): Mode {
  if (!value || value === 'factcheck') {
    return 'factcheck';
  }
  if (value === 'script' || value === 'scriptcheck') {
    return 'scriptcheck';
  }
  throw new Error(`未知模式：${value}（可选 factcheck / scriptcheck，简写 script）`);
}

/** 从 .cache/previews 读回预览；只接受安全文件名。 */
async function loadPreview(previewId: string): Promise<ClaimsPreview> {
  if (!/^[A-Za-z0-9_-]+$/.test(previewId)) {
    throw new Error(`previewId 非法：${previewId}`);
  }
  const file = path.join(process.cwd(), '.cache', 'previews', `${previewId}.json`);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(`找不到预览 ${previewId}，请先运行 pnpm run:claims 生成`);
  }
  const parsed: unknown = JSON.parse(raw);
  return ClaimsPreviewSchema.parse(parsed);
}

function printEvent(event: CaseEvent): void {
  switch (event.type) {
    case 'case':
      console.log(`\n▶ 立案 ${event.id}`);
      break;
    case 'stage':
      console.log(`[${event.stage}] ${event.status === 'start' ? '开始' : '完成'} ${event.message}`);
      break;
    case 'claims':
      console.log(
        `  疑点 ${event.claims.length} 个：${event.claims.map((claim) => claim.id).join('、')}`,
      );
      break;
    case 'source':
      console.log(
        `  + 来源 ${event.source.id} [${event.source.direction}] ${event.source.site} ${event.source.title}`,
      );
      break;
    case 'source_update':
      break;
    case 'groups':
      console.log(`  同源组 ${event.groups.length} 个`);
      break;
    case 'timeline':
      console.log(`  时间线 ${event.claimId}：${event.steps.length} 步`);
      break;
    case 'claim_progress':
      if (event.status === 'done') {
        console.log(`  ✓ 疑点 ${event.claimId} 判决完成`);
      }
      break;
    case 'billing':
      console.log(
        `  结算：扣费 ${event.billing.charged} 元，退款 ${event.billing.refunded} 元`,
      );
      break;
    case 'verdict':
      console.log(`  整案结论：${event.verdict.headline}（置信度 ${event.verdict.confidence}）`);
      break;
    case 'stats':
      break;
    case 'error':
      console.log(`  ! ${event.message}`);
      break;
    case 'done':
      console.log(`▶ 结案 ${event.caseFile.id}`);
      break;
  }
}

/** 搜索次数：优先取实际执行的检索计划，其次取判决里的 searches，最后按检索词估算。 */
function searchCountOf(
  original: Claim | undefined,
  claimId: string,
  sources: Source[],
  verdict: Verdict | null,
): { count: number; exact: boolean } {
  const plan = original ? getExecutedSearchPlan(original) : undefined;
  if (plan) {
    return { count: plan.executed, exact: true };
  }
  const item = verdict?.claims.find((claim) => claim.claimId === claimId);
  if (item?.searches !== undefined) {
    return { count: item.searches, exact: true };
  }
  const queries = new Set(
    sources.filter((source) => source.claimId === claimId).map((source) => source.query),
  );
  return { count: queries.size, exact: false };
}

async function main(): Promise<void> {
  const { text: rawText, flags } = parseArgs(process.argv.slice(2));
  const modeFlag = resolveMode(flags.get('mode'));
  const previewId = flags.get('preview');
  const selectFlag = flags.get('select');
  const saveAs = flags.get('save-as');

  let preview: ClaimsPreview | undefined;
  if (previewId) {
    preview = await loadPreview(previewId);
  } else if (selectFlag) {
    throw new Error('--select 需要配合 --preview 使用');
  }

  const input = rawText || preview?.input || '';
  if (!input.trim()) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const selectedClaimIds =
    selectFlag === undefined
      ? undefined
      : selectFlag
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);

  console.log(`输入: ${input}`);
  if (preview) {
    console.log(`预览: ${preview.previewId}（${preview.claims.length} 个疑点，模式 ${preview.mode}）`);
  }
  if (selectedClaimIds && selectedClaimIds.length > 0) {
    console.log(`选中: ${selectedClaimIds.join('、')}`);
  }

  const sources: Source[] = [];
  const startedAt = Date.now();
  const caseFile = await runInvestigation(
    input,
    (event) => {
      printEvent(event);
      if (event.type === 'source') {
        sources.push(event.source);
      }
    },
    {
      mode: preview?.mode ?? modeFlag,
      ...(preview ? { claims: preview.claims } : {}),
      ...(selectedClaimIds && selectedClaimIds.length > 0 ? { selectedClaimIds } : {}),
      ...(preview ? { previewId: preview.previewId } : {}),
    },
  );

  const originals = new Map<string, Claim>();
  for (const claim of preview?.claims ?? []) {
    originals.set(claim.id, claim);
  }

  console.log('\n疑点与搜索次数:');
  if (caseFile.claims.length === 0) {
    console.log('- 本次没有可查证的疑点');
  }
  for (const claim of caseFile.claims) {
    const { count, exact } = searchCountOf(
      originals.get(claim.id),
      claim.id,
      sources,
      caseFile.verdict,
    );
    const sourceCount = sources.filter((source) => source.claimId === claim.id).length;
    console.log(`- ${claim.id} ${claim.text}`);
    console.log(`  搜索 ${count} 次${exact ? '' : '（按检索词估算）'} / 来源 ${sourceCount} 条`);
  }

  const { stats } = caseFile;
  console.log('\n统计:');
  console.log(`- 接口调用 ${stats.apiCalls} 次`);
  console.log(`- 到访来源 ${stats.sourcesVisited} 条`);
  console.log(`- 独立证人 ${stats.independentWitnesses} 个`);
  console.log(`- 查证疑点 ${stats.claimsChecked ?? 0} 个`);
  console.log(`- 耗时 ${stats.durationMs}ms（命令行 ${Date.now() - startedAt}ms）`);

  if (caseFile.billing) {
    const billing = caseFile.billing;
    const refund =
      billing.refundClaimIds.length > 0
        ? `退款 ${billing.refunded} 元（${billing.refundClaimIds.join('、')}）`
        : '无退款';
    console.log('\n结算:');
    console.log(
      `- 单价 ${billing.pricePerClaim} 元 × 查证 ${billing.checkedClaimIds.length} 个 = 扣费 ${billing.charged} 元`,
    );
    console.log(`- ${refund}`);
    if (billing.reason) {
      console.log(`- 说明：${billing.reason}`);
    }
  }

  console.log(`\n卷宗: .cache/cases/${caseFile.id}.json`);

  if (saveAs) {
    if (!/^[A-Za-z0-9_-]+$/.test(saveAs)) {
      throw new Error(`--save-as 名称非法：${saveAs}`);
    }
    await mkdir('cache', { recursive: true });
    const file = path.join('cache', `${saveAs}.json`);
    await writeFile(file, `${JSON.stringify(caseFile, null, 2)}\n`, 'utf8');
    console.log(`已保存演示卷宗: ${file}`);
  }
}

main().catch((error: unknown) => {
  console.error('调查失败:', error);
  process.exitCode = 1;
});

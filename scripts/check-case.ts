/**
 * 演示卷宗人工审核：打印判决、独立证人数、时间线步数与引用有效性。
 * 用法：pnpm check:case <卷宗 id 或 json 路径> [--md [输出路径]]
 * 引用无效或判决缺失时以非零退出码结束，方便发布前自查。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadCaseFile } from '../lib/case-store';
import { caseFileToMarkdown } from '../lib/export-md';
import { countIndependent } from '../lib/pipeline/cluster';
import { CaseFileSchema, type CaseFile, type Source, type VerdictLevel } from '../types/case';

const USAGE = '用法: pnpm check:case <卷宗 id 或 json 路径> [--md [输出路径]]';

const LEVEL_NAMES: Record<VerdictLevel, string> = {
  true: '属实',
  partly_true: '部分属实',
  out_of_context: '断章取义',
  unverified: '无法证实',
  false: '谣言',
};

/** 输入原文在审核输出里只显示前若干字，避免长文案刷屏。 */
const INPUT_PREVIEW_LIMIT = 80;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

type ParsedArgs = {
  target: string;
  markdown: boolean;
  output?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const words: string[] = [];
  let markdown = false;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--md') {
      markdown = true;
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        output = next;
        index += 1;
      }
      continue;
    }
    words.push(item);
  }

  return {
    target: words.join(' ').trim(),
    markdown,
    ...(output ? { output } : {}),
  };
}

/** 参数既可以是演示 id，也可以是仓库内的 json 路径。 */
async function loadTarget(target: string): Promise<CaseFile | undefined> {
  const isPath = target.endsWith('.json') || target.includes('/');
  if (!isPath) {
    return loadCaseFile(target);
  }

  try {
    const raw: unknown = JSON.parse(await readFile(target, 'utf8'));
    const parsed = CaseFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** 引用有效性：来源必须存在且没有标记为不可达；跨疑点引用只作为提醒。 */
function citationIssues(
  caseFile: CaseFile,
  sourceById: Map<string, Source>,
): { fatal: string[]; warnings: string[] } {
  const fatal: string[] = [];
  const warnings: string[] = [];
  for (const item of caseFile.verdict?.claims ?? []) {
    const seen = new Set<string>();
    for (const id of item.citationIds) {
      if (seen.has(id)) {
        fatal.push(`疑点 ${item.claimId} 重复引用 ${id}`);
        continue;
      }
      seen.add(id);

      const source = sourceById.get(id);
      if (!source) {
        fatal.push(`疑点 ${item.claimId} 引用了不存在的来源 ${id}`);
        continue;
      }
      if (source.reachable === false) {
        fatal.push(`疑点 ${item.claimId} 引用了不可达来源 ${id}（${source.site}）`);
        continue;
      }
      if (source.claimId !== item.claimId) {
        warnings.push(`疑点 ${item.claimId} 引用了属于 ${source.claimId} 的来源 ${id}`);
      }
    }
  }
  return { fatal, warnings };
}

function labelOf(target: string, caseFile: CaseFile): string {
  if (!target.endsWith('.json') && /^[A-Za-z0-9_-]+$/.test(target)) {
    return target;
  }
  return caseFile.id;
}

async function writeMarkdown(caseFile: CaseFile, file: string): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  await writeFile(file, caseFileToMarkdown(caseFile), 'utf8');
}

async function main(): Promise<void> {
  const { target, markdown, output } = parseArgs(process.argv.slice(2));
  if (!target) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const caseFile = await loadTarget(target);
  if (!caseFile) {
    console.error(`找不到卷宗或未通过 CaseFileSchema 校验：${target}`);
    process.exitCode = 1;
    return;
  }

  const sourceById = new Map(caseFile.sources.map((source) => [source.id, source]));
  const witnesses = countIndependent(caseFile.groups, caseFile.sources);
  const timelineSteps = caseFile.claims.map((claim) => ({
    claim,
    steps: caseFile.timelines[claim.id] ?? [],
  }));
  const totalSteps = timelineSteps.reduce((sum, item) => sum + item.steps.length, 0);
  const { fatal, warnings } = citationIssues(caseFile, sourceById);
  if (!caseFile.verdict) {
    fatal.push('未生成整案判决');
  } else if (caseFile.verdict.claims.length !== caseFile.claims.length) {
    fatal.push('逐疑点判决数量与疑点数量不一致');
  }

  console.log(`\n卷宗: ${target}`);
  console.log(`- 案件编号: ${caseFile.id}`);
  console.log(`- 模式: ${caseFile.mode ?? 'factcheck'}`);
  console.log(`- 输入: ${truncate(caseFile.input.replace(/\s+/g, ' ').trim(), INPUT_PREVIEW_LIMIT)}`);

  console.log('\n判决:');
  if (!caseFile.verdict) {
    console.log('- 未生成判决');
  } else {
    console.log(
      `- ${LEVEL_NAMES[caseFile.verdict.level]}（${caseFile.verdict.level}），置信度 ${Math.round(
        caseFile.verdict.confidence * 100,
      )}%`,
    );
    console.log(`- 结论: ${caseFile.verdict.headline}`);
  }

  const citations = (caseFile.verdict?.claims ?? []).reduce(
    (sum, item) => sum + item.citationIds.length,
    0,
  );
  const deadLinks = caseFile.sources.filter((source) => source.reachable === false).length;
  const verdict = caseFile.verdict;

  console.log('\n审核指标:');
  console.log(
    `- 判决档位: ${verdict ? `${verdict.level}（${LEVEL_NAMES[verdict.level]}）` : '未生成'}`,
  );
  console.log(`- evidenceState: ${verdict?.evidenceState ?? '未标注'}`);
  console.log(
    `- 独立证人数: ${witnesses}（stats 记录 ${caseFile.stats.independentWitnesses}）`,
  );
  console.log(`- 时间线步数: ${totalSteps}`);
  console.log(`- 无效引用数: ${fatal.length}（共 ${citations} 个引用）`);
  console.log(`- 被移除的失效链接数: ${deadLinks}`);

  console.log('\n引用校验:');
  if (fatal.length === 0) {
    console.log(`- 引用全部有效（共 ${citations} 个引用）`);
  } else {
    console.log(`- 发现 ${fatal.length} 个引用问题（共 ${citations} 个引用）`);
    for (const issue of fatal) {
      console.log(`  ! ${issue}`);
    }
  }
  if (warnings.length > 0) {
    console.log(`- ${warnings.length} 条跨疑点引用提醒：`);
    for (const warning of warnings) {
      console.log(`  ~ ${warning}`);
    }
  }

  console.log('\n时间线:');
  for (const { claim, steps } of timelineSteps) {
    console.log(`  ${claim.id} ${steps.length} 步 · ${claim.text}`);
  }

  console.log('\n逐疑点:');
  for (const claim of caseFile.claims) {
    const item = caseFile.verdict?.claims.find((entry) => entry.claimId === claim.id);
    if (!item) {
      console.log(`- ${claim.id} 未生成判决 · ${claim.text}`);
      continue;
    }
    console.log(
      `- ${claim.id} ${LEVEL_NAMES[item.level]}（${Math.round(
        item.confidence * 100,
      )}%）· 引用 ${item.citationIds.length} 条 · ${claim.text}`,
    );
  }

  if (markdown) {
    const file = path.resolve(output ?? path.join('cache', 'reports', `${labelOf(target, caseFile)}.md`));
    await writeMarkdown(caseFile, file);
    console.log(`\nMarkdown 报告: ${path.relative(process.cwd(), file)}`);
  }

  if (fatal.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('审核失败:', error);
  process.exitCode = 1;
});

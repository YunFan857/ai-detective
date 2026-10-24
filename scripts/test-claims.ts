/**
 * 疑点抽取回归脚本。
 * 运行：pnpm exec tsx scripts/test-claims.ts [A4消息文件] [四渡赤水文案文件]
 * 未传文件时使用环境变量 A4_MESSAGES_JSON 和 SCRIPT_TEXT，避免把未提供的原文伪造进仓库。
 */
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { extractClaims } from '../lib/pipeline/claims';
import { searchStats } from '../lib/yuanbao';

const DEFAULT_A4 = [
  process.env.A4_MESSAGE_1,
  process.env.A4_MESSAGE_2,
  process.env.A4_MESSAGE_3,
].filter((value): value is string => Boolean(value));

async function readOptional(path: string | undefined): Promise<string | undefined> {
  return path ? readFile(path, 'utf8') : undefined;
}

async function main(): Promise<void> {
  const a4Path = process.argv[2];
  const scriptPath = process.argv[3];
  const a4Messages = a4Path
    ? (await readFile(a4Path, 'utf8'))
        .split(/\n\s*---+\s*\n/u)
        .map((value) => value.trim())
        .filter(Boolean)
    : process.env.A4_MESSAGES_JSON
      ? (JSON.parse(process.env.A4_MESSAGES_JSON) as string[])
      : DEFAULT_A4;
  const script = (await readOptional(scriptPath)) ?? process.env.SCRIPT_TEXT;
  if (a4Messages.length !== 3 || !script) {
    throw new Error(
      '请提供 A4 三条消息与四渡赤水文案：A4_MESSAGES_JSON、SCRIPT_TEXT，或传入两个文件路径。',
    );
  }
  const cases = [
    ...a4Messages.map((input, index) => ({
      name: `A4-${index + 1}`,
      input,
      mode: 'factcheck' as const,
    })),
    { name: '四渡赤水', input: script, mode: 'scriptcheck' as const },
  ];
  for (const item of cases) {
    const started = performance.now();
    const claims = await extractClaims(item.input, { mode: item.mode });
    const elapsed = Math.round(performance.now() - started);
    console.log(`\n[${item.name}] ${item.mode} ${elapsed}ms, claims=${claims.length}`);
    for (const claim of claims) {
      const matched = claim.span
        ? item.input.slice(claim.span.start, claim.span.end) === claim.sentence
        : false;
      console.log(
        JSON.stringify({
          id: claim.id,
          risk: claim.riskLevel,
          signals: claim.signals,
          spanMatched: matched,
          span: claim.span,
        }),
      );
    }
  }
  console.log(`\nsearchStats.calls=${searchStats.calls}`);
  if (searchStats.calls !== 0) throw new Error('疑点抽取不应调用元宝搜索');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

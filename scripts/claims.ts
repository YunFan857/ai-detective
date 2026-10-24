import dotenv from 'dotenv';
import { previewClaims } from '../lib/pipeline';
import type { Mode } from '../types/case';

dotenv.config({ path: '.env.local' });
dotenv.config();

type ParsedArgs = {
  text: string;
  flags: Map<string, string>;
};

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

const RISK_NAMES: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
};

async function main(): Promise<void> {
  const { text, flags } = parseArgs(process.argv.slice(2));
  if (!text) {
    console.error('用法: pnpm run:claims "要拆解的文本" [--mode script]');
    process.exitCode = 1;
    return;
  }

  const mode = resolveMode(flags.get('mode'));
  const preview = await previewClaims(text, { mode });

  console.log(`previewId: ${preview.previewId}`);
  console.log(`模式: ${preview.mode === 'scriptcheck' ? '文案体检' : '消息查证'}（${preview.mode}）`);
  console.log(`疑点: ${preview.claims.length} 个 · 单价 ${preview.pricePerClaim} 元/个`);
  console.log(`自动查证: ${preview.autoRun ? '是（仅 1–2 个疑点）' : '否，请勾选后立案'}`);
  console.log(`已保存: .cache/previews/${preview.previewId}.json`);

  if (preview.claims.length === 0) {
    console.log('\n未拆出可核查疑点。');
    return;
  }

  console.log('');
  for (const claim of preview.claims) {
    const risk = RISK_NAMES[claim.riskLevel ?? 'low'] ?? claim.riskLevel ?? '未评级';
    const category = claim.category ?? claim.kind;
    console.log(`${claim.id} [${risk}/${category}] ${claim.text}`);
    if (claim.signals && claim.signals.length > 0) {
      console.log(`  信号: ${claim.signals.join('、')}`);
    }
    if (claim.span) {
      console.log(`  span: ${claim.span.start}-${claim.span.end}`);
    }
    if (claim.sentence) {
      console.log(`  原句: ${claim.sentence}`);
    }
    if (claim.consequence) {
      console.log(`  风险后果: ${claim.consequence}`);
    }
  }

  const ids = preview.claims.map((claim) => claim.id).join(',');
  console.log('');
  console.log(`下一步: pnpm run:case --preview ${preview.previewId} --select ${ids}`);
}

main().catch((error: unknown) => {
  console.error('拆疑点失败:', error);
  process.exitCode = 1;
});

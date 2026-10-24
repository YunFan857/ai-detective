/**
 * SSE 接口联调脚本。
 * 1. mock 回放：POST /api/investigate { mock: true }，逐行打印事件类型；
 * 2. 演示回放：POST /api/investigate { demoId }，确认卷宗拆事件后的节奏；
 * 3. 两步流程：先 POST /api/extract-claims 取 previewId，再带 previewId + claims +
 *    selectedClaimIds 立案，重点打印 claim_progress 与 billing。
 *
 * 运行前先启动 dev server：
 *   USE_MOCK=true pnpm dev
 *   pnpm exec tsx scripts/test-sse.ts
 * 需要联网模型时去掉 USE_MOCK；BASE_URL 可用环境变量覆盖。
 */
import type { CaseEvent, Claim } from '../types/case';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const COFFEE_INPUT = '网传喝咖啡会致癌，还说专家已经证实了，每天一杯风险增加 30%，这是真的吗？';
const DEMO_ID = 'case-20240603-coffee';
const SCRIPT_TEXT =
  '都说和珅是清朝第一贪官，抄家时搜出白银八亿两，相当于清政府二十年的财政收入，' +
  '嘉庆皇帝一登基就把他赐死，这就是和珅跌倒嘉庆吃饱的由来。可很少有人知道，' +
  '这笔数字最早出自民间抄本，正史里并没有明确记载，真实的查抄清单至今仍有争议。';

interface SseHandlers {
  onEvent: (event: CaseEvent) => void;
  onHeartbeat?: () => void;
}

/** 读取 text/event-stream，按空行切块解析 data: 与注释心跳。 */
async function readSse(response: Response, handlers: SseHandlers): Promise<void> {
  if (!response.body) {
    throw new Error('响应没有 body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consume = (block: string): void => {
    const dataLines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) {
      if (block.split('\n').some((line) => line.startsWith(':'))) {
        handlers.onHeartbeat?.();
      }
      return;
    }
    const payload = JSON.parse(dataLines.join('\n')) as CaseEvent;
    handlers.onEvent(payload);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (block.trim()) consume(block);
      index = buffer.indexOf('\n\n');
    }
  }

  if (buffer.trim()) consume(buffer);
}

function describe(event: CaseEvent): string {
  switch (event.type) {
    case 'stage':
      return `${event.stage} · ${event.status}`;
    case 'claims':
      return `${event.claims.length} 个疑点`;
    case 'source':
      return `${event.source.claimId} · ${event.source.site}`;
    case 'verdict':
      return `${event.verdict.level} · ${event.verdict.headline}`;
    case 'claim_progress':
      return `${event.claimId} · ${event.status}`;
    case 'billing':
      return `扣费 ${event.billing.charged} 元 / 退款 ${event.billing.refunded} 元`;
    case 'error':
      return `${event.recoverable ? '可恢复' : '不可恢复'} · ${event.message}`;
    default:
      return '';
  }
}

/** 打印一个 SSE 响应的全部事件类型，返回事件列表。 */
async function runStream(label: string, path: string, body: unknown): Promise<CaseEvent[]> {
  console.log(`\n=== ${label} ===`);
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.log(`HTTP ${response.status}: ${await response.text()}`);
    return [];
  }

  const events: CaseEvent[] = [];
  await readSse(response, {
    onEvent(event) {
      events.push(event);
      const detail = describe(event);
      console.log(`[${event.type}]${detail ? ` ${detail}` : ''}`);
    },
    onHeartbeat() {
      console.log('[heartbeat] ping');
    },
  });

  console.log(`共 ${events.length} 个事件`);
  return events;
}

/** 第 1 步：mock 事件回放。 */
async function checkMockReplay(): Promise<void> {
  await runStream('mock 回放', '/api/investigate', { text: COFFEE_INPUT, mock: true });
}

/** 第 2 步：演示卷宗按 20 秒节奏回放。 */
async function checkDemoReplay(): Promise<void> {
  await runStream('演示卷宗回放', '/api/investigate', { demoId: DEMO_ID });
}

/** 第 3 步：拆疑点 → 选择疑点 → 立案。 */
async function checkTwoPhase(): Promise<void> {
  console.log('\n=== 两步流程 · 1/2 拆解疑点 ===');
  const previewResponse = await fetch(`${BASE_URL}/api/extract-claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'scriptcheck', text: SCRIPT_TEXT }),
  });

  if (!previewResponse.ok) {
    console.log(`HTTP ${previewResponse.status}: ${await previewResponse.text()}`);
    return;
  }

  const preview = (await previewResponse.json()) as {
    previewId: string;
    mode?: string;
    claims: Claim[];
  };
  console.log(`previewId: ${preview.previewId}，疑点 ${preview.claims.length} 个`);
  for (const claim of preview.claims) {
    console.log(`- ${claim.id} ${claim.text}`);
  }

  const selectedClaimIds = preview.claims.slice(0, 2).map((claim) => claim.id);
  console.log(`选中：${selectedClaimIds.join('、') || '无'}`);
  if (selectedClaimIds.length === 0) {
    console.log('预览没有疑点，跳过立案');
    return;
  }

  const events = await runStream('两步流程 · 2/2 立案', '/api/investigate', {
    mode: preview.mode ?? 'scriptcheck',
    previewId: preview.previewId,
    // mock 预览不会落盘 .cache/previews，需同时回传 claims + text 作为兜底。
    text: SCRIPT_TEXT,
    claims: preview.claims,
    selectedClaimIds,
  });

  console.log('\n--- claim_progress ---');
  const progress = events.filter(
    (event): event is Extract<CaseEvent, { type: 'claim_progress' }> =>
      event.type === 'claim_progress',
  );
  if (progress.length === 0) console.log('（无）');
  for (const event of progress) {
    console.log(`${event.claimId} · ${event.status}`);
  }

  console.log('\n--- billing ---');
  const billing = events.find(
    (event): event is Extract<CaseEvent, { type: 'billing' }> => event.type === 'billing',
  );
  console.log(billing ? JSON.stringify(billing.billing, null, 2) : '（无）');
}

async function main(): Promise<void> {
  await checkMockReplay();
  await checkDemoReplay();
  await checkTwoPhase();
  console.log('\nSSE 联调结束');
}

main().catch((error: unknown) => {
  console.error('SSE 联调失败:', error);
  process.exitCode = 1;
});

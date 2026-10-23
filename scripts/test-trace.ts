/**
 * 溯源时间线专项验收。
 * 1. 咖啡案例跑真实链路，断言节点来源、顺序、数量、quote 与事件；
 * 2. 构造节点不足两个的场景，断言空时间线、不调用模型、仍推送事件。
 *
 * 运行：pnpm exec tsx scripts/test-trace.ts
 */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { llmStats } from '../lib/llm';
import { extractClaims } from '../lib/pipeline/claims';
import { gatherEvidence } from '../lib/pipeline/search';
import { gradeSources } from '../lib/pipeline/grade';
import { clusterSources } from '../lib/pipeline/cluster';
import { traceTimeline } from '../lib/pipeline/trace';
import type { CaseEvent, Claim, Source, SourceGroup, TimelineStep } from '../types/case';

dotenv.config({ path: '.env.local' });
dotenv.config();

const COFFEE_INPUT = '网传喝咖啡会致癌，还说专家已经证实了，每天一杯风险增加 30%，这是真的吗？';
const MAX_STEPS = 5;

type TimelineEvent = Extract<CaseEvent, { type: 'timeline' }>;

function timelineEventsOf(events: CaseEvent[], claimId: string): TimelineEvent[] {
  return events.filter(
    (event): event is TimelineEvent => event.type === 'timeline' && event.claimId === claimId,
  );
}

/** 断言单个疑点的时间线满足约定。 */
function assertTimeline(
  claim: Claim,
  steps: TimelineStep[],
  sources: Source[],
  groups: SourceGroup[],
  events: CaseEvent[],
): void {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const originIds = new Set(
    groups.filter((group) => group.claimId === claim.id).map((group) => group.originSourceId),
  );

  assert.ok(steps.length <= MAX_STEPS, `${claim.id} 步数超过 ${MAX_STEPS}：${steps.length}`);

  const ids = steps.map((step) => step.sourceId);
  assert.equal(new Set(ids).size, ids.length, `${claim.id} 存在重复 sourceId`);

  for (const step of steps) {
    const source = sourceById.get(step.sourceId);
    assert.ok(source, `${claim.id} 的节点 ${step.sourceId} 不在 sources 中`);
    assert.equal(source.claimId, claim.id, `${claim.id} 的节点 ${step.sourceId} 属于其他疑点`);
    assert.ok(originIds.has(step.sourceId), `${claim.id} 的节点 ${step.sourceId} 不是同源组首发源`);

    if (source.snippet.trim()) {
      assert.ok(
        source.snippet.includes(step.quote),
        `${claim.id} 的 quote 不是摘要连续子串：${step.quote}`,
      );
    } else {
      assert.equal(step.quote, source.title.trim(), `${claim.id} 空摘要时应退回标题`);
    }
  }

  const times = steps
    .map((step) => step.publishedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value));
  for (let index = 1; index < times.length; index += 1) {
    assert.ok(
      times[index - 1] <= times[index],
      `${claim.id} 的发布时间不是升序：${new Date(times[index - 1]).toISOString()} → ${new Date(times[index]).toISOString()}`,
    );
  }

  const timelineEvents = timelineEventsOf(events, claim.id);
  assert.equal(timelineEvents.length, 1, `${claim.id} 应恰好推送一次 timeline 事件`);
  assert.deepEqual(timelineEvents[0].steps, steps, `${claim.id} 事件中的 steps 与返回值不一致`);
}

/** 咖啡案例：真实链路 + 时间线断言。 */
async function runCoffeeCase(): Promise<void> {
  const claims = await extractClaims(COFFEE_INPUT);
  assert.ok(claims.length > 0, '咖啡案例未拆出疑点');

  const sources: Source[] = [];
  await gatherEvidence(claims, (event) => {
    if (event.type === 'source') sources.push(event.source);
  });

  const graded = await gradeSources(claims, sources, () => {});
  const groups = await clusterSources(claims, graded, () => {});

  const traceEvents: CaseEvent[] = [];
  const timelines = await traceTimeline(claims, graded, groups, (event) => {
    traceEvents.push(event);
  });

  for (const claim of claims) {
    assertTimeline(claim, timelines[claim.id], graded, groups, traceEvents);
  }

  const longest = Math.max(...claims.map((claim) => timelines[claim.id].length));
  assert.ok(longest >= 3, `咖啡案例最多只有 ${longest} 步，未达到 3 步`);

  console.log('\n=== 咖啡案例时间线 ===');
  for (const claim of claims) {
    const steps = timelines[claim.id];
    console.log(`\n## ${claim.id} ${claim.text}（${steps.length} 步）`);
    steps.forEach((step, index) => {
      const source = graded.find((item) => item.id === step.sourceId);
      console.log(`${index + 1}. [${step.publishedAt ?? '无时间'}] ${source?.site ?? '-'} ${source?.title ?? ''}`);
      console.log(`   quote: ${step.quote}`);
      console.log(`   mutation: ${step.mutation ?? '（首节点）'}`);
    });
  }

  const errors = traceEvents
    .filter((event): event is Extract<CaseEvent, { type: 'error' }> => event.type === 'error')
    .map((event) => event.message);
  if (errors.length > 0) {
    console.log('\ntrace 降级事件：');
    for (const message of errors) console.log(`! ${message}`);
  }
}

/** 节点不足两个：返回空时间线、不调用模型、仍推送事件。 */
async function runSparseCase(): Promise<void> {
  const claims: Claim[] = [
    { id: 'u-one', text: '只有一个节点的疑点', kind: 'other' },
    { id: 'u-zero', text: '没有节点的疑点', kind: 'other' },
  ];
  const sources: Source[] = [
    {
      id: 'u-s1',
      claimId: 'u-one',
      url: 'https://example.com/only-one',
      site: 'example.com',
      title: '独立来源',
      snippet: '这是唯一一条来源的摘要首句。第二句不应被选中。',
      publishedAt: '2024-01-01T00:00:00.000Z',
      direction: 'pro',
      query: '疑点检索词',
      stance: 'support',
      tier: 'media',
    },
  ];
  const groups: SourceGroup[] = [
    {
      id: 'ug1',
      claimId: 'u-one',
      originSourceId: 'u-s1',
      memberIds: ['u-s1'],
      reason: '独立信源',
    },
  ];

  const events: CaseEvent[] = [];
  const callsBefore = llmStats.calls;
  const timelines = await traceTimeline(claims, sources, groups, (event) => {
    events.push(event);
  });
  const callsAfter = llmStats.calls;

  assert.deepEqual(timelines, { 'u-one': [], 'u-zero': [] }, '节点不足时应返回空时间线');
  assert.equal(callsAfter, callsBefore, '节点不足时不应调用大模型');

  for (const claim of claims) {
    const timelineEvents = timelineEventsOf(events, claim.id);
    assert.equal(timelineEvents.length, 1, `${claim.id} 应仍推送一次 timeline 事件`);
    assert.deepEqual(timelineEvents[0].steps, [], `${claim.id} 事件 steps 应为空`);
  }

  const errors = events.filter((event) => event.type === 'error');
  assert.equal(errors.length, 0, '节点不足时不应产生错误事件');

  console.log('\n=== 节点不足场景 ===');
  console.log(`timeline 事件 ${events.length} 个，steps 均为空，模型调用 0 次`);
}

async function main(): Promise<void> {
  await runSparseCase();
  await runCoffeeCase();
  console.log('\n全部 trace 断言通过');
}

main().catch((error: unknown) => {
  console.error('trace 验收失败:', error);
  process.exitCode = 1;
});

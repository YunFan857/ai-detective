/**
 * 同源合并单元脚本：用 mock/case-demo.json 的来源跑一遍 clusterSources。
 * 复核环节使用确定性桩，保证同一输入多次运行结果完全一致。
 * 运行：pnpm tsx scripts/test-cluster.ts
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { embed, llmStats } from '../lib/llm';
import { clusterSources, countIndependent, type ClusterDeps } from '../lib/pipeline/cluster';
import {
  CaseFileSchema,
  type CaseEvent,
  type Source,
  type SourceGroup,
  type Tier,
} from '../types/case';

dotenv.config({ path: '.env.local' });
dotenv.config();

/**
 * 按疑点拆分的洗稿期望（实测余弦，阈值 0.88）：
 * - c1：10 vs 11 = 0.818，未达阈值，必须分开；
 * - c2：04/05/09 = 0.939/0.918/0.907 应合并，07 与其它三条最高 0.823 应独立；
 * - c3：06 vs 08 = 0.899，应合并。
 */
const EXPECT_MERGED: Record<string, string[]> = {
  c2: ['src_marketing_04', 'src_wash_05', 'src_wash_09'],
  c3: ['src_wash_06', 'src_wash_08'],
};

/** 实测未达 0.88 / 0.45 的洗稿对，必须留在不同组。 */
const EXPECT_DIFFERENT: [string, string][] = [
  ['src_wash_10', 'src_wash_11'],
  ['src_wash_07', 'src_marketing_04'],
  ['src_wash_07', 'src_wash_05'],
  ['src_wash_07', 'src_wash_09'],
];

/** 官方辟谣来源：不并入洗稿组，也不单独成组。 */
const OFFICIAL_ONLY = 'src_official_13';

const TIER_RANK: Record<Tier, number> = {
  official: 4,
  media: 3,
  self: 2,
  marketing: 1,
  unknown: 0,
};

const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`);
  if (!ok) {
    failures.push(name);
  }
}

/**
 * 复核桩：以组内多数立场为准，只保留立场相同的成员。
 * 真实模型复核在同一输入上出现过不同结论（c3 一次保留、一次拆散），
 * 这里用确定性规则替代，保证单元测试可重复。
 */
const stubReview: ClusterDeps['review'] = async (members) => {
  const counts = new Map<string, number>();
  for (const member of members) {
    const stance = member.stance ?? 'unknown';
    counts.set(stance, (counts.get(stance) ?? 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    keep: members
      .filter((member) => (member.stance ?? 'unknown') === dominant)
      .map((member) => member.id),
    reason: '组内多数立场一致，判定为同源转载；立场相反者保留为独立信源。',
  };
};

/** 主场景：真实向量 + 确定性复核桩。 */
const mainDeps: ClusterDeps = {
  embed: (texts) => embed(texts),
  review: stubReview,
};

/** 降级场景：向量接口主动抛错，应回退到 3-gram Jaccard。 */
const offlineDeps: ClusterDeps = {
  embed: async () => {
    throw new Error('模拟向量服务不可用');
  },
  review: stubReview,
};

type RunResult = {
  groups: SourceGroup[];
  events: CaseEvent[];
  updates: Map<string, { groupId?: string; isOrigin?: boolean }>;
  updateCount: Map<string, number>;
};

/** 去掉 mock 里预置的 groupId / isOrigin，确保结果全部来自本次聚类。 */
function stripGroups(source: Source): Source {
  return {
    id: source.id,
    claimId: source.claimId,
    url: source.url,
    site: source.site,
    title: source.title,
    snippet: source.snippet,
    publishedAt: source.publishedAt,
    direction: source.direction,
    query: source.query,
    stance: source.stance,
    tier: source.tier,
  };
}

async function runCase(
  claims: Parameters<typeof clusterSources>[0],
  sources: Source[],
  deps: ClusterDeps,
): Promise<RunResult> {
  const events: CaseEvent[] = [];
  const groups = await clusterSources(claims, sources, (event) => events.push(event), deps);

  const updates = new Map<string, { groupId?: string; isOrigin?: boolean }>();
  const updateCount = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'source_update') {
      continue;
    }
    updates.set(event.id, { ...updates.get(event.id), ...event.patch });
    updateCount.set(event.id, (updateCount.get(event.id) ?? 0) + 1);
  }

  return { groups, events, updates, updateCount };
}

function expectedOrigin(group: SourceGroup, sources: Source[]): Source | undefined {
  const members = sources.filter((source) => group.memberIds.includes(source.id));
  const timed = members
    .map((source) => ({ source, time: source.publishedAt ? Date.parse(source.publishedAt) : NaN }))
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time);

  if (timed.length > 0) {
    return timed[0].source;
  }
  return [...members].sort(
    (a, b) => TIER_RANK[b.tier ?? 'unknown'] - TIER_RANK[a.tier ?? 'unknown'],
  )[0];
}

function printTable(
  sources: Source[],
  updates: Map<string, { groupId?: string; isOrigin?: boolean }>,
): void {
  const header = ['sourceId', 'claimId', 'stance', 'tier', 'groupId', 'isOrigin'];
  const rows = sources.map((source) => [
    source.id,
    source.claimId,
    source.stance ?? '-',
    source.tier ?? 'unknown',
    updates.get(source.id)?.groupId ?? '-',
    updates.get(source.id)?.isOrigin === true ? 'true' : 'false',
  ]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((row) => row[index].length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join(' | ');

  console.log(line(header));
  console.log(widths.map((width) => '-'.repeat(width)).join('-+-'));
  rows.forEach((row) => console.log(line(row)));
}

/**
 * 结构断言：只建多人组、成员不重复、非成员无 groupId、isOrigin 与 emit 顺序。
 */
function checkIntegrity(label: string, sources: Source[], result: RunResult): void {
  const { groups, events, updates, updateCount } = result;

  const memberIds = groups.flatMap((group) => group.memberIds);
  const memberSet = new Set(memberIds);
  const singletonGroups = groups.filter((group) => group.memberIds.length < 2);
  const grouped = sources.filter((source) => memberSet.has(source.id));
  const ungrouped = sources.filter((source) => !memberSet.has(source.id));

  check(
    `${label}同源组只保留至少两条成员`,
    singletonGroups.length === 0,
    singletonGroups.map((group) => group.id).join(', '),
  );
  check(
    `${label}每条来源最多属于一个组，成员只出现一次`,
    memberIds.length === memberSet.size &&
      grouped.every(
        (source) => updateCount.get(source.id) === 1 && !!updates.get(source.id)?.groupId,
      ),
    `组成员 ${grouped.length} 条 / 全部 ${sources.length} 条`,
  );
  check(
    `${label}未合组来源不带 groupId`,
    ungrouped.every(
      (source) => updateCount.get(source.id) === undefined && !updates.get(source.id)?.groupId,
    ),
    ungrouped.map((source) => source.id).join(', '),
  );

  const claimDrift = groups.filter((group) => {
    const members = sources.filter((source) => group.memberIds.includes(source.id));
    return members.some((source) => source.claimId !== group.claimId);
  });
  check(
    `${label}每个组的成员 claimId 与组一致`,
    claimDrift.length === 0,
    claimDrift.map((g) => g.id).join(', '),
  );

  const originMismatch = groups.filter(
    (group) =>
      group.memberIds.filter((id) => updates.get(id)?.isOrigin === true).length !== 1 ||
      updates.get(group.originSourceId)?.isOrigin !== true,
  );
  check(
    `${label}每组恰有一个 isOrigin 且与 originSourceId 一致`,
    originMismatch.length === 0,
    originMismatch.map((g) => g.id).join(', '),
  );

  const originDrift = groups.filter(
    (group) => group.originSourceId !== expectedOrigin(group, sources)?.id,
  );
  check(
    `${label}首发源取组内最早发布时间（无时间取 tier 最高）`,
    originDrift.length === 0,
    originDrift.map((g) => g.id).join(', '),
  );

  const groupsEvents = events.filter((event) => event.type === 'groups');
  const lastEvent = events[events.length - 1];
  check(`${label}最终只 emit 一次 groups`, groupsEvents.length === 1);
  check(
    `${label}全部 source_update 早于 groups 事件`,
    lastEvent?.type === 'groups' &&
      events.slice(0, -1).every((event) => event.type === 'source_update'),
  );
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const raw = readFileSync(join(process.cwd(), 'mock/case-demo.json'), 'utf8');
  const demo = CaseFileSchema.parse(JSON.parse(raw));
  const sources = demo.sources.map(stripGroups);

  const result = await runCase(demo.claims, sources, mainDeps);
  const { groups, updates } = result;

  console.log(`来源 ${sources.length} 条，合并为 ${groups.length} 组\n`);
  printTable(sources, updates);
  console.log('');

  for (const group of groups) {
    console.log(
      `[${group.id}] claim=${group.claimId} origin=${group.originSourceId} members=${group.memberIds.join(', ')}`,
    );
    console.log(`  reason：${group.reason}`);
  }
  console.log('');

  checkIntegrity('', sources, result);

  const groupIdOf = (sourceId: string): string =>
    groups.find((group) => group.memberIds.includes(sourceId))?.id ?? 'missing';

  for (const [claimId, washIds] of Object.entries(EXPECT_MERGED)) {
    const groupIds = washIds.map(groupIdOf);
    const merged = new Set(groupIds).size === 1 && !groupIds.includes('missing');
    const group = groups.find((item) => item.id === groupIds[0]);
    check(
      `${claimId} 的 ${washIds.length} 条洗稿过阈值后合到同一组`,
      merged,
      merged ? `${groupIds[0]}（${group?.memberIds.join(', ') ?? ''}）` : groupIds.join(' / '),
    );
  }

  const wrongSplit = EXPECT_DIFFERENT.filter(([left, right]) => {
    const leftGroup = groupIdOf(left);
    const rightGroup = groupIdOf(right);
    // 两条都未合组，说明确实不同源，符合预期。
    if (leftGroup === 'missing' && rightGroup === 'missing') {
      return false;
    }
    return leftGroup === rightGroup;
  });
  check(
    '未达阈值的洗稿对保持独立',
    wrongSplit.length === 0,
    wrongSplit.map(([left, right]) => `${left}=${right}`).join(', '),
  );

  check(
    '洗稿组按疑点隔离（c2 / c3 两组互不合并）',
    groupIdOf('src_marketing_04') !== groupIdOf('src_wash_06'),
  );

  const officialGroup = groups.find((group) => group.memberIds.includes(OFFICIAL_ONLY));
  check(
    'c2 的官方辟谣来源不并入洗稿组，也不单独成组',
    officialGroup === undefined && !updates.get(OFFICIAL_ONLY)?.groupId,
    officialGroup ? officialGroup.id : '未建组',
  );

  const independent = countIndependent(groups, sources);
  const relevantCount = sources.filter((source) => source.stance !== 'irrelevant').length;
  const foldedCount = groups.reduce((sum, group) => sum + (group.memberIds.length - 1), 0);
  check(
    'countIndependent = 相关来源数 − 被折叠的转载数',
    independent === relevantCount - foldedCount,
    `${independent} = ${relevantCount} − ${foldedCount}`,
  );

  // 降级场景：向量接口抛错，应回退 3-gram Jaccard，且结构断言仍成立
  console.log('\n—— 降级场景（embed 主动抛错）——');
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((item) => String(item)).join(' '));
  };
  let fallback: RunResult;
  try {
    fallback = await runCase(demo.claims, sources, offlineDeps);
  } finally {
    console.warn = originalWarn;
  }

  check(
    '向量失败时输出明确降级日志',
    warnings.some((line) => line.includes('降级为 3-gram Jaccard')),
    `${warnings.length} 条日志`,
  );
  check(
    '向量失败时不中断，照常返回分组结果（Jaccard 未命中时可为 0 组）',
    fallback.events.some((event) => event.type === 'groups'),
    `${fallback.groups.length} 组`,
  );
  checkIntegrity('[降级] ', sources, fallback);
  console.log(
    `[降级] 分组结果：${fallback.groups.map((group) => group.memberIds.join('+')).join(' | ')}`,
  );

  console.log(
    `\nSIGNATURE ${groups
      .map(
        (group) =>
          `${group.id}:${group.claimId}:${group.originSourceId}:${group.memberIds.join(',')}`,
      )
      .join(' ; ')}`,
  );
  console.log(
    `\n模型调用 ${llmStats.calls} 次，tokens ${llmStats.tokens}，耗时 ${Date.now() - startedAt}ms`,
  );

  if (failures.length > 0) {
    console.error(`\n失败 ${failures.length} 项：${failures.join('；')}`);
    process.exitCode = 1;
    return;
  }
  console.log('\n全部检查通过');
}

main().catch((error: unknown) => {
  console.error('脚本执行失败:', error);
  process.exitCode = 1;
});

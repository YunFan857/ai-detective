/**
 * 同源合并「真实模型验收」脚本（仅用于手动验收，不提交）。
 * - 使用 mock/case-demo.json，不修改 mock；
 * - 直接调用 clusterSources(...) 的默认依赖：不传 ClusterDeps，不注入 embed / review 桩；
 * - 实际调用 embedding 与真实 chatJSON 复核，连续运行 5 次；
 * - 任一 run 失败时打印真实 review 的脱敏 JSON（keep / reason）与导致拆分的排除成员，
 *   绝不使用确定性桩、绝不掩盖失败。
 * 运行：pnpm tsx scripts/test-cluster-live.ts
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusterSources } from '../lib/pipeline/cluster';
import {
  CaseFileSchema,
  type CaseEvent,
  type Claim,
  type Source,
  type SourceGroup,
} from '../types/case';

dotenv.config({ path: '.env.local' });
dotenv.config();

const RUNS = 5;

/** 必须合组（真实向量下已过 0.88 阈值，复核不应拆散） */
const EXPECT_MERGED: { label: string; ids: string[] }[] = [
  { label: 'c2(04/05/09)', ids: ['src_marketing_04', 'src_wash_05', 'src_wash_09'] },
  { label: 'c3(06/08)', ids: ['src_wash_06', 'src_wash_08'] },
];

/** 必须分开（未达 0.88 / 0.45 阈值） */
const EXPECT_SPLIT: { label: string; left: string; right: string }[] = [
  { label: 'c1(10/11)', left: 'src_wash_10', right: 'src_wash_11' },
];

/** 不能被并入任何同源组 */
const EXPECT_SOLO = { label: 'c2(07)', id: 'src_wash_07' };

type ReviewCapture = {
  run: number;
  /** 请求里出现的来源 id（来自 system prompt 的 `id: xxx` 行） */
  requestIds: string[];
  temperature: number | null;
  /** 真实模型返回的原始文本（已解析为 JSON 时同时给出 keep / reason） */
  raw: string;
  keep: string[] | null;
  reason: string | null;
  parseError?: string;
};

const captures: ReviewCapture[] = [];
let currentRun = 0;

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function readMemberIds(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  const text = messages
    .map((message) =>
      typeof message === 'object' &&
      message !== null &&
      typeof (message as { content?: unknown }).content === 'string'
        ? (message as { content: string }).content
        : '',
    )
    .join('\n');
  const ids = new Set<string>();
  for (const match of text.matchAll(/^id:\s*(\S+)\s*$/gm)) {
    ids.add(match[1]);
  }
  return [...ids];
}

/**
 * 只旁路「真实 review 输出」用于失败诊断：
 * 不替换依赖、不改请求内容，仅克隆 /chat/completions 的响应体做只读记录。
 */
function installReviewObserver(): void {
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes('/chat/completions')) {
      return originalFetch(input, init);
    }

    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const requestBody = parseJsonLoose(bodyText);
    const requestIds = readMemberIds(requestBody);
    const temperature =
      typeof requestBody === 'object' &&
      requestBody !== null &&
      typeof (requestBody as { temperature?: unknown }).temperature === 'number'
        ? (requestBody as { temperature: number }).temperature
        : null;

    const response = await originalFetch(input, init);
    const raw = await response.clone().text();

    const payload = parseJsonLoose(raw);
    const content =
      typeof payload === 'object' &&
      payload !== null &&
      Array.isArray((payload as { choices?: unknown }).choices) &&
      typeof (payload as { choices: { message?: { content?: unknown } }[] }).choices[0]?.message
        ?.content === 'string'
        ? (payload as { choices: { message: { content: string } }[] }).choices[0].message.content
        : '';

    const parsed = content ? parseJsonLoose(content) : null;
    const keep =
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { keep?: unknown }).keep)
        ? (parsed as { keep: unknown[] }).keep.filter((id): id is string => typeof id === 'string')
        : null;
    const reason =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { reason?: unknown }).reason === 'string'
        ? (parsed as { reason: string }).reason
        : null;

    captures.push({
      run: currentRun,
      requestIds,
      temperature,
      raw,
      keep,
      reason,
      parseError: parsed === null ? 'review 输出无法解析为 JSON' : undefined,
    });

    return response;
  }) as typeof fetch;
}

type RunResult = {
  groups: SourceGroup[];
  updates: Map<string, { groupId?: string; isOrigin?: boolean }>;
  memberGroup: Map<string, string>;
  events: CaseEvent[];
};

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

async function runOnce(claims: Claim[], sources: Source[]): Promise<RunResult> {
  const events: CaseEvent[] = [];
  const groups = await clusterSources(claims, sources, (event) => events.push(event));

  const updates = new Map<string, { groupId?: string; isOrigin?: boolean }>();
  const memberGroup = new Map<string, string>();
  for (const group of groups) {
    for (const id of group.memberIds) {
      memberGroup.set(id, group.id);
    }
  }
  for (const event of events) {
    if (event.type === 'source_update') {
      updates.set(event.id, { ...updates.get(event.id), ...event.patch });
    }
  }

  return { groups, updates, memberGroup, events };
}

function signature(groups: SourceGroup[]): string {
  return groups
    .map(
      (group) =>
        `${group.id}:${group.claimId}:${group.originSourceId}:${group.memberIds.join(',')}`,
    )
    .join(' ; ');
}

function describeGroup(groupId: string, groups: SourceGroup[]): string {
  if (groupId === 'missing') {
    return '未合组';
  }
  const group = groups.find((item) => item.id === groupId);
  return group ? `${group.id}(${group.memberIds.join(',')})` : `${groupId}(missing)`;
}

type Attempt = {
  failed: string[];
};

function evaluate(sources: Source[], result: RunResult): Attempt {
  const { groups, updates, memberGroup } = result;
  const failed: string[] = [];
  const groupIdOf = (id: string): string => memberGroup.get(id) ?? 'missing';

  const claimDrift = groups.filter((group) => {
    const members = sources.filter((source) => group.memberIds.includes(source.id));
    return members.some((source) => source.claimId !== group.claimId);
  });
  if (claimDrift.length > 0) {
    failed.push(`组内 claimId 不一致：${claimDrift.map((group) => group.id).join(', ')}`);
  }

  const memberIds = groups.flatMap((group) => group.memberIds);
  const memberSet = new Set(memberIds);
  const grouped = sources.filter((source) => memberSet.has(source.id));
  const ungrouped = sources.filter((source) => !memberSet.has(source.id));

  const singletonGroups = groups.filter((group) => group.memberIds.length < 2);
  const missingGroup = grouped.filter((source) => !updates.get(source.id)?.groupId);
  const leakedGroup = ungrouped.filter((source) => updates.get(source.id)?.groupId);
  if (
    singletonGroups.length > 0 ||
    memberIds.length !== memberSet.size ||
    missingGroup.length > 0 ||
    leakedGroup.length > 0
  ) {
    failed.push(
      `groupId 覆盖异常：单人组 ${singletonGroups.map((g) => g.id).join(',') || '无'}；重复成员 ${
        memberIds.length - memberSet.size
      } 条；成员缺 groupId ${missingGroup.map((s) => s.id).join(',') || '无'}；非成员带 groupId ${
        leakedGroup.map((s) => s.id).join(',') || '无'
      }`,
    );
  }

  const originMismatch = groups.filter(
    (group) =>
      group.memberIds.filter((id) => updates.get(id)?.isOrigin === true).length !== 1 ||
      updates.get(group.originSourceId)?.isOrigin !== true,
  );
  if (originMismatch.length > 0) {
    failed.push(`isOrigin 异常：${originMismatch.map((group) => group.id).join(', ')}`);
  }

  for (const item of EXPECT_MERGED) {
    const ids = item.ids.map(groupIdOf);
    if (new Set(ids).size !== 1 || ids.includes('missing')) {
      failed.push(`${item.label} 未合组：${ids.join(' / ')}`);
    }
  }

  for (const item of EXPECT_SPLIT) {
    const left = groupIdOf(item.left);
    const right = groupIdOf(item.right);
    // 两条都未合组，说明确实不同源，符合预期。
    if (left === 'missing' && right === 'missing') {
      continue;
    }
    if (left === right) {
      failed.push(`${item.label} 未分开：${left} / ${right}`);
    }
  }

  const soloGroup = groups.find((group) => group.memberIds.includes(EXPECT_SOLO.id));
  if (soloGroup || updates.get(EXPECT_SOLO.id)?.groupId) {
    failed.push(
      `${EXPECT_SOLO.label} 不应合组：${soloGroup ? `${soloGroup.id}(${soloGroup.memberIds.join(',')})` : updates.get(EXPECT_SOLO.id)?.groupId}`,
    );
  }

  return { failed };
}

function printRunDetail(
  index: number,
  result: RunResult,
  elapsedMs: number,
  attempt: Attempt,
): void {
  const { groups, memberGroup } = result;
  const groupIdOf = (id: string): string => memberGroup.get(id) ?? 'missing';

  console.log(`\n=========== run ${index}/${RUNS} ===========`);
  console.log(`耗时：${elapsedMs}ms，组数：${groups.length}`);
  console.log(`SIGNATURE ${signature(groups)}`);

  for (const item of EXPECT_MERGED) {
    const ids = item.ids.map(groupIdOf);
    const merged = new Set(ids).size === 1 && !ids.includes('missing');
    console.log(
      `${merged ? '✓' : '✗'} ${item.label} ${merged ? '合组' : '未合组'}：${describeGroup(ids[0], groups)}${
        merged ? '' : `（${ids.join(' / ')}）`
      }`,
    );
  }

  for (const item of EXPECT_SPLIT) {
    const left = groupIdOf(item.left);
    const right = groupIdOf(item.right);
    const split = left !== right || (left === 'missing' && right === 'missing');
    console.log(
      `${split ? '✓' : '✗'} ${item.label} ${split ? '分开' : '未分开'}：${describeGroup(left, groups)} / ${describeGroup(right, groups)}`,
    );
  }

  const solo = groupIdOf(EXPECT_SOLO.id);
  const soloOk = solo === 'missing';
  console.log(
    `${soloOk ? '✓' : '✗'} ${EXPECT_SOLO.label} ${soloOk ? '独立（未合组）' : '误合组'}：${describeGroup(solo, groups)}`,
  );

  if (attempt.failed.length === 0) {
    console.log('✓ 结构断言：只建多人组 / claimId 隔离 / groupId 覆盖 / 每组唯一 isOrigin');
    return;
  }

  console.log(`✗ 失败 ${attempt.failed.length} 项：`);
  for (const reason of attempt.failed) {
    console.log(`  - ${reason}`);
  }

  const relevantCaptures = captures.filter((item) => item.run === index);
  if (relevantCaptures.length === 0) {
    console.log('  [review] 本次没有发生真实复核调用（可能相似度未达阈值，未进入复核）');
    return;
  }

  for (const item of relevantCaptures) {
    const excluded = item.keep
      ? item.requestIds.filter((id) => !item.keep?.includes(id))
      : item.requestIds;
    console.log('  [review 脱敏输出]');
    console.log(`    temperature: ${item.temperature === null ? 'unknown' : item.temperature}`);
    console.log(`    members: ${item.requestIds.join(', ')}`);
    if (item.keep !== null) {
      console.log(`    keep: ${item.keep.join(', ') || '(空)'}`);
      console.log(`    exclusionReason: ${item.reason ?? '(空)'}`);
      console.log(
        `    被排除：${excluded.length > 0 ? excluded.join(', ') : '无'}（该成员不并入该组）`,
      );
    } else {
      console.log(
        `    解析失败：${item.parseError ?? 'unknown'}；原始输出：${item.raw.slice(0, 300)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  installReviewObserver();

  const raw = readFileSync(join(process.cwd(), 'mock/case-demo.json'), 'utf8');
  const demo = CaseFileSchema.parse(JSON.parse(raw));
  const sources = demo.sources.map(stripGroups);

  console.log('真实模型验收（默认依赖：真实 embedding + 真实 chatJSON，temperature=0.2）');
  console.log(`来源 ${sources.length} 条，连续运行 ${RUNS} 次\n`);

  let passed = 0;
  const failures: string[] = [];

  for (let index = 1; index <= RUNS; index += 1) {
    currentRun = index;
    const startedAt = Date.now();
    const result = await runOnce(demo.claims, sources);
    const elapsedMs = Date.now() - startedAt;
    const attempt = evaluate(sources, result);

    const badTemperature = captures.filter(
      (item) => item.run === index && item.temperature !== 0.2,
    );
    if (badTemperature.length > 0) {
      attempt.failed.push(
        `review 调用未显式使用 temperature=0.2：${badTemperature
          .map((item) => item.temperature ?? 'unknown')
          .join(', ')}`,
      );
    }

    printRunDetail(index, result, elapsedMs, attempt);

    if (attempt.failed.length === 0) {
      passed += 1;
    } else {
      failures.push(`run ${index}：${attempt.failed.join('；')}`);
    }
  }

  console.log(`\n=========== 汇总 ===========`);
  console.log(`通过 ${passed}/${RUNS} 次`);
  console.log(`真实复核调用 ${captures.length} 次`);
  if (failures.length > 0) {
    console.error(`失败明细：\n${failures.map((item) => `  - ${item}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    '5 次均满足：04/05/09 合组、06/08 合组、10/11 分开、07 未合组、只建多人组、claimId 隔离、groupId 完整、每组唯一 isOrigin',
  );
}

main().catch((error: unknown) => {
  console.error('脚本执行失败:', error);
  process.exitCode = 1;
});

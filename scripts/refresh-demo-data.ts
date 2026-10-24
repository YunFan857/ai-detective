/**
 * 演示卷宗刷新：把 cache/ 下的旧卷宗对齐到当前流水线的来源与同源组约定。
 * 只做本地数据归一化，不调用搜索与大模型：
 * - 站点缺失用域名兜底，标题 / 摘要折叠空白；
 * - 摘要截断到 200 字（含省略号）；
 * - 补齐 publishedAtStatus（可解析时间为 known，否则 missing）；
 * - 丢弃成员数 < 2 的同源组，重排 groupId 并回写 isOrigin。
 *
 * 用法：pnpm exec tsx scripts/refresh-demo-data.ts
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { caseFileToEvents } from '../lib/replay';
import { CaseFileSchema, type CaseFile, type Source, type SourceGroup } from '../types/case';

const DEMO_DIR = path.join(process.cwd(), 'cache');
const MAX_SNIPPET_CHARS = 200;

/** 折叠连续空白并去掉首尾空白。 */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** 站点名缺失时用域名兜底，去掉 www. 前缀。 */
function siteFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** 摘要按字符截断，超过上限时补省略号。 */
function clipSnippet(text: string): string {
  const chars = [...text];
  if (chars.length <= MAX_SNIPPET_CHARS) {
    return text;
  }
  return `${chars.slice(0, MAX_SNIPPET_CHARS - 1).join('')}…`;
}

/** 只保留可解析的 ISO 时间。 */
function parsePublishedAt(value: string | undefined): string | undefined {
  if (!value || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return value;
}

/** 来源字段按契约顺序重建，保证与流水线输出一致。 */
function normalizeSource(source: Source): Source {
  const publishedAt = parsePublishedAt(source.publishedAt);

  return {
    id: source.id,
    claimId: source.claimId,
    url: source.url,
    site: normalizeText(source.site) || siteFromUrl(source.url),
    title: normalizeText(source.title),
    snippet: clipSnippet(normalizeText(source.snippet)),
    ...(publishedAt ? { publishedAt } : {}),
    publishedAtStatus: publishedAt ? 'known' : 'missing',
    direction: source.direction,
    query: source.query,
    ...(source.stance !== undefined ? { stance: source.stance } : {}),
    ...(source.tier !== undefined ? { tier: source.tier } : {}),
    ...(source.groupId !== undefined ? { groupId: source.groupId } : {}),
    ...(source.isOrigin !== undefined ? { isOrigin: source.isOrigin } : {}),
    ...(source.reachable !== undefined ? { reachable: source.reachable } : {}),
  };
}

/** 丢弃单成员组，按序重排 groupId，并重新回写来源的 groupId / isOrigin。 */
function normalizeGroups(caseFile: CaseFile): CaseFile {
  const groups = caseFile.groups
    .filter((group) => group.memberIds.length >= 2)
    .map((group, index) => ({ ...group, id: `g${index + 1}` }));

  const groupBySource = new Map<string, { id: string; originSourceId: string }>();
  for (const group of groups) {
    for (const id of group.memberIds) {
      groupBySource.set(id, { id: group.id, originSourceId: group.originSourceId });
    }
  }

  const sources = caseFile.sources.map((source) => {
    const next: Source = { ...source };
    delete next.groupId;
    delete next.isOrigin;

    const hit = groupBySource.get(source.id);
    if (hit) {
      next.groupId = hit.id;
      next.isOrigin = source.id === hit.originSourceId;
    }

    return next;
  });

  return { ...caseFile, sources, groups };
}

/** 独立信源数 = 相关来源数 − 被同源组折叠的转载数，与 countIndependent 保持一致。 */
function countIndependent(sources: Source[], groups: SourceGroup[]): number {
  const relevant = sources.filter((source) => source.stance !== 'irrelevant').length;
  const folded = groups.reduce((sum, group) => sum + Math.max(0, group.memberIds.length - 1), 0);
  return Math.max(0, relevant - folded);
}

/** 归一化一份卷宗：先处理来源字段，再按同源组回写分组信息并校正独立信源数。 */
function normalizeCaseFile(caseFile: CaseFile): CaseFile {
  const withGroups = normalizeGroups({
    ...caseFile,
    sources: caseFile.sources.map(normalizeSource),
  });

  return {
    ...withGroups,
    stats: {
      ...withGroups.stats,
      independentWitnesses: countIndependent(withGroups.sources, withGroups.groups),
    },
  };
}

async function main(): Promise<void> {
  const names = (await readdir(DEMO_DIR)).filter((name) => name.endsWith('.json')).sort();
  const pending: { name: string; caseFile: CaseFile }[] = [];

  for (const name of names) {
    const file = path.join(DEMO_DIR, name);
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
    const parsed = CaseFileSchema.safeParse(raw);
    if (!parsed.success) {
      // index.json / preview-*.json 不是卷宗，跳过。
      continue;
    }

    const caseFile = CaseFileSchema.parse(normalizeCaseFile(parsed.data));
    // 回放一次，确认事件流仍然合法。
    caseFileToEvents(caseFile, 20000);
    pending.push({ name, caseFile });
  }

  for (const { name, caseFile } of pending) {
    const file = path.join(DEMO_DIR, name);
    await writeFile(file, `${JSON.stringify(caseFile, null, 2)}\n`, 'utf8');
    console.log(
      `[refresh-demo] ${name}: sources=${caseFile.sources.length}, groups=${caseFile.groups.length}, status=${caseFile.sources.filter((source) => source.publishedAtStatus).length}`,
    );
  }

  console.log(`[refresh-demo] 完成，共刷新 ${pending.length} 份演示卷宗`);
}

void main();

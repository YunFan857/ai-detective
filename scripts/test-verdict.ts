/**
 * 结案判决（A9）纯规则路径验收。
 * 默认删除 LLM_* 环境变量让模型调用立即失败，确保所有规则断言不依赖真实模型；
 * 只有在需要验证引用清洗与文案截断时，才挂一个本地 OpenAI 兼容 stub。
 *
 * 运行：pnpm tsx scripts/test-verdict.ts
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import caseDemo from '../mock/case-demo.json';
import {
  checkReachability,
  collectWitnesses,
  makeVerdict,
  type EvidenceState,
  type Witness,
} from '../lib/pipeline/verdict';
import {
  CaseFileSchema,
  VerdictSchema,
  type Claim,
  type Source,
  type SourceGroup,
  type Stance,
  type Tier,
  type TimelineStep,
  type Verdict,
} from '../types/case';

const MAX_HEADLINE_CHARS = 12;
const MAX_TITLE_CHARS = 16;
const MAX_BODY_CHARS = 80;

const CITATION_RE = /\[([^[\]]+)\]/g;

type StubReply = Record<string, unknown>;

function charLength(text: string): number {
  return [...text].length;
}

function must<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** 让 lib/llm.ts 的 readEnv 立即抛错，不发起任何网络请求。 */
function disableLlm(): void {
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
}

/** 链接校验全程离线：example.com 一律可达，含 dead 的返回 404；本地 stub 服务透传。 */
function installFetchStub(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('127.0.0.1')) {
      return original(input, init);
    }
    return new Response('', { status: url.includes('dead') ? 404 : 200 });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

function captureWarnings(): { messages: string[]; restore: () => void } {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.map((item) => String(item)).join(' '));
  };
  return {
    messages,
    restore: () => {
      console.warn = original;
    },
  };
}

function makeClaim(id: string, text: string): Claim {
  return { id, text, kind: 'other' };
}

function makeSource(options: {
  id: string;
  claimId: string;
  site?: string;
  stance?: Stance;
  tier?: Tier;
  url?: string;
  query?: string;
  publishedAt?: string;
}): Source {
  return {
    id: options.id,
    claimId: options.claimId,
    url: options.url ?? `https://example.com/${options.id}`,
    site: options.site ?? `站点 ${options.id}`,
    title: `标题 ${options.id}`,
    snippet: `摘要 ${options.id}`,
    publishedAt: options.publishedAt ?? '2024-01-01T00:00:00.000Z',
    direction: options.stance === 'refute' ? 'con' : 'pro',
    query: options.query ?? '测试检索词',
    stance: options.stance,
    tier: options.tier,
  };
}

function makeGroup(
  id: string,
  claimId: string,
  originSourceId: string,
  memberIds: string[],
): SourceGroup {
  return { id, claimId, originSourceId, memberIds, reason: '测试同源组' };
}

function tokenOf(sourceId: string, sources: Source[]): string {
  const index = sources.findIndex((source) => source.id === sourceId);
  return index === -1 ? '?' : `s${index + 1}`;
}

function formatWitnesses(witnesses: Witness[], sources: Source[]): string[] {
  return witnesses.map(
    (witness) =>
      `[${tokenOf(witness.source.id, sources)}] ${witness.source.id}｜${witness.source.site}｜stance=${witness.stance}｜tier=${witness.tier}`,
  );
}

function tokensOf(text: string): string[] {
  return [...text.matchAll(CITATION_RE)].map((match) => match[1]);
}

/** 只校验摘要里的编号都真实存在。 */
function assertKnownTokens(summary: string, sources: Source[], label: string): void {
  const known = new Set(sources.map((source, index) => `s${index + 1}`));
  for (const token of tokensOf(summary)) {
    assert.ok(known.has(token), `${label} 引用了不存在的 [${token}]`);
  }
}

/** 疑点摘要与 citationIds 必须双向一致。 */
function assertClaimCitations(
  summary: string,
  citationIds: string[],
  sources: Source[],
  label: string,
): void {
  const knownIds = new Set(sources.map((source) => source.id));
  assertKnownTokens(summary, sources, label);

  for (const id of citationIds) {
    assert.ok(knownIds.has(id), `${label} 的 citationIds 含不存在的来源 ${id}`);
  }

  const summaryTokens = new Set(tokensOf(summary));
  const idTokens = new Set(citationIds.map((id) => tokenOf(id, sources)));
  assert.deepEqual(
    [...summaryTokens].sort(),
    [...idTokens].sort(),
    `${label} 的 summary 引用编号与 citationIds 不双向一致`,
  );
}

function assertVerdict(verdict: Verdict, sources: Source[], label: string): void {
  VerdictSchema.parse(verdict);

  const headlineLength = charLength(verdict.headline);
  assert.ok(
    headlineLength > 0 && headlineLength <= MAX_HEADLINE_CHARS,
    `${label} 的 headline 长度 ${headlineLength} 超出 1-${MAX_HEADLINE_CHARS} 字`,
  );

  const titleLength = charLength(verdict.rebuttalCard.title);
  assert.ok(
    titleLength > 0 && titleLength <= MAX_TITLE_CHARS,
    `${label} 的 rebuttalCard.title 长度 ${titleLength} 超出 1-${MAX_TITLE_CHARS} 字`,
  );

  const bodyLength = charLength(verdict.rebuttalCard.body);
  assert.ok(
    bodyLength > 0 && bodyLength <= MAX_BODY_CHARS,
    `${label} 的 rebuttalCard.body 长度 ${bodyLength} 超出 1-${MAX_BODY_CHARS} 字`,
  );
  assert.match(
    verdict.rebuttalCard.body,
    /来源：.+$/,
    `${label} 的 rebuttalCard.body 没有以「来源：xxx」收尾`,
  );

  assert.ok(!verdict.summary.includes('【'), `${label} 的整案 summary 残留全角引用符号`);
  assertKnownTokens(verdict.summary, sources, `${label} 的整案 summary`);

  for (const item of verdict.claims) {
    assert.ok(!item.summary.includes('【'), `${label} 的 ${item.claimId} summary 残留全角引用符号`);
    assertClaimCitations(item.summary, item.citationIds, sources, `${label} 的 ${item.claimId}`);
  }
}

type RuleCase = {
  label: string;
  input: string;
  claims: Claim[];
  sources: Source[];
  groups: SourceGroup[];
  timelines: Record<string, TimelineStep[]>;
  expectLevel: Verdict['level'];
  expectConfidence?: number;
  expectEvidenceState: EvidenceState;
};

/** 规则路径：模型必定失败，只用规则结论与兜底文案。 */
async function runRuleCase(testCase: RuleCase): Promise<Verdict> {
  const capture = captureWarnings();
  try {
    const verdict = await makeVerdict(
      testCase.input,
      testCase.claims,
      testCase.sources,
      testCase.groups,
      testCase.timelines,
    );

    assert.equal(
      capture.messages.length,
      2,
      `${testCase.label} 应发生 2 次降级，实际 ${capture.messages.length} 次`,
    );
    assert.ok(
      capture.messages[0].includes('疑点判决生成失败'),
      `${testCase.label} 第一次降级不是疑点判决：${capture.messages[0]}`,
    );
    assert.ok(
      capture.messages[1].includes('整案结论生成失败'),
      `${testCase.label} 第二次降级不是整案结论：${capture.messages[1]}`,
    );

    assertVerdict(verdict, testCase.sources, testCase.label);
    assert.equal(verdict.level, testCase.expectLevel, `${testCase.label} 的整案判决不符`);
    assert.equal(
      verdict.evidenceState,
      testCase.expectEvidenceState,
      `${testCase.label} 的 evidenceState 不符`,
    );
    if (testCase.expectConfidence !== undefined) {
      assert.equal(
        verdict.confidence,
        testCase.expectConfidence,
        `${testCase.label} 的整案置信度不符`,
      );
    }

    const levelList = verdict.claims.map((item) => `${item.claimId}=${item.level}`).join(', ');
    console.log(
      `✓ ${testCase.label}：${verdict.level} ${verdict.confidence}（疑点 ${levelList}）｜${verdict.headline}`,
    );
    return verdict;
  } finally {
    capture.restore();
  }
}

/** 1. 属实：至少 2 个独立支持，其中至少 1 个权威，且无权威反驳。 */
async function testTrue(): Promise<void> {
  const claim = makeClaim('t1', '网传每天喝咖啡可以防癌。');
  const sources = [
    makeSource({
      id: 't1-official',
      claimId: 't1',
      site: '国家癌症中心',
      stance: 'support',
      tier: 'official',
    }),
    makeSource({ id: 't1-official-repost', claimId: 't1', stance: 'support', tier: 'self' }),
    makeSource({
      id: 't1-media',
      claimId: 't1',
      site: '健康时报网',
      stance: 'support',
      tier: 'media',
    }),
    makeSource({ id: 't1-media-repost', claimId: 't1', stance: 'support', tier: 'self' }),
    makeSource({ id: 't1-self', claimId: 't1', stance: 'support', tier: 'self' }),
  ];
  const groups = [
    makeGroup('tg1', 't1', 't1-official', ['t1-official', 't1-official-repost']),
    makeGroup('tg2', 't1', 't1-media', ['t1-media', 't1-media-repost']),
  ];

  const witnesses = collectWitnesses(claim, sources, groups);
  assert.equal(witnesses.length, 3, '同源转载不应增加独立证人');
  const supporters = witnesses.filter((witness) => witness.stance === 'support');
  assert.ok(supporters.length >= 2, '属实需要至少 2 个独立支持');
  assert.ok(
    supporters.some((witness) => witness.tier === 'official' || witness.tier === 'media'),
    '属实需要至少 1 个 official/media 支持',
  );
  assert.equal(
    witnesses.filter(
      (witness) =>
        witness.stance === 'refute' && (witness.tier === 'official' || witness.tier === 'media'),
    ).length,
    0,
    '属实不应存在 official/media 明确反驳',
  );

  console.log('\n=== 1. true ===');
  for (const line of formatWitnesses(witnesses, sources)) {
    console.log(`- ${line}`);
  }

  await runRuleCase({
    label: 'true',
    input: '网传每天喝咖啡可以防癌，这是真的吗？',
    claims: [claim],
    sources,
    groups,
    timelines: {},
    expectLevel: 'true',
    expectConfidence: 0.82,
    expectEvidenceState: 'multi',
  });
}

/** 2. 谣言：权威明确反驳 / 支持方全部来自营销号。 */
async function testFalse(): Promise<void> {
  console.log('\n=== 2. false ===');

  // 2a. 官方明确反驳，支持方只有自媒体
  const refutedClaim = makeClaim('f1', '专家已经证实咖啡会致癌。');
  const refutedSources = [
    makeSource({
      id: 'f1-official',
      claimId: 'f1',
      site: '国家食品安全风险评估中心',
      stance: 'refute',
      tier: 'official',
    }),
    makeSource({ id: 'f1-self', claimId: 'f1', stance: 'support', tier: 'self' }),
  ];
  const refutedWitnesses = collectWitnesses(refutedClaim, refutedSources, []);
  const authorityRefuters = refutedWitnesses.filter(
    (witness) =>
      witness.stance === 'refute' && (witness.tier === 'official' || witness.tier === 'media'),
  );
  assert.ok(authorityRefuters.length >= 1, '2a 必须存在 official/media 的明确反驳');
  for (const line of formatWitnesses(refutedWitnesses, refutedSources)) {
    console.log(`- 权威反驳：${line}`);
  }
  await runRuleCase({
    label: 'false（官方反驳）',
    input: '专家已经证实咖啡会致癌。',
    claims: [refutedClaim],
    sources: refutedSources,
    groups: [],
    timelines: {},
    expectLevel: 'false',
    expectConfidence: 0.9,
    expectEvidenceState: 'multi',
  });

  // 2b. 支持方全部来自营销号，反驳方只有自媒体
  const marketingClaim = makeClaim('f2', '喝咖啡能排毒养颜。');
  const marketingSources = [
    makeSource({ id: 'f2-mkt1', claimId: 'f2', stance: 'support', tier: 'marketing' }),
    makeSource({ id: 'f2-mkt2', claimId: 'f2', stance: 'support', tier: 'marketing' }),
    makeSource({ id: 'f2-self', claimId: 'f2', stance: 'refute', tier: 'self' }),
  ];
  const marketingWitnesses = collectWitnesses(marketingClaim, marketingSources, []);
  const marketingSupporters = marketingWitnesses.filter((witness) => witness.stance === 'support');
  assert.ok(marketingSupporters.length >= 2, '2b 需要多个支持方');
  assert.ok(
    marketingSupporters.every((witness) => witness.tier === 'marketing'),
    '2b 的支持方必须全部是营销号',
  );
  assert.equal(
    marketingWitnesses.filter(
      (witness) =>
        witness.stance === 'refute' && (witness.tier === 'official' || witness.tier === 'media'),
    ).length,
    0,
    '2b 不应依赖权威反驳',
  );

  const verdict = await runRuleCase({
    label: 'false（只有营销号支持）',
    input: '喝咖啡能排毒养颜。',
    claims: [marketingClaim],
    sources: marketingSources,
    groups: [],
    timelines: {},
    expectLevel: 'false',
    expectConfidence: 0.8,
    expectEvidenceState: 'multi',
  });
  const marketingVerdict = must(
    verdict.claims.find((item) => item.claimId === 'f2'),
    '2b 缺少 f2 的疑点判决',
  );
  assert.ok(
    marketingVerdict.summary.includes('营销号'),
    `2b 的疑点摘要应点明营销号：${marketingVerdict.summary}`,
  );
}

/** 3. 断章取义：同源时间线出现明确传播变形，且没有权威反驳覆盖。 */
async function testOutOfContext(): Promise<void> {
  const claim = makeClaim('o1', '研究已经证实咖啡会致癌。');
  const sources = [
    makeSource({
      id: 'o1-official',
      claimId: 'o1',
      site: '中国营养学会',
      stance: 'support',
      tier: 'official',
    }),
    makeSource({ id: 'o1-repost', claimId: 'o1', stance: 'support', tier: 'self' }),
    makeSource({ id: 'o1-self-refute', claimId: 'o1', stance: 'refute', tier: 'self' }),
  ];
  const groups = [makeGroup('og1', 'o1', 'o1-official', ['o1-official', 'o1-repost'])];
  const timelines: Record<string, TimelineStep[]> = {
    o1: [
      {
        sourceId: 'o1-official',
        publishedAt: '2024-03-01T00:00:00.000Z',
        quote: '研究观察到弱相关，作者强调相关不等于因果。',
      },
      {
        sourceId: 'o1-repost',
        publishedAt: '2024-04-01T00:00:00.000Z',
        quote: '研究证实咖啡会致癌。',
        mutation: '删去“可能相关”的前提，改写成“已经证实”。',
      },
    ],
  };

  const witnesses = collectWitnesses(claim, sources, groups);
  assert.ok(
    witnesses.some(
      (witness) =>
        witness.stance === 'refute' && (witness.tier === 'official' || witness.tier === 'media'),
    ) === false,
    '3 不应存在 official/media 反驳，否则会被 false 规则优先覆盖',
  );
  assert.ok(
    witnesses.some((witness) => witness.source.id === 'o1-official' && witness.tier === 'official'),
    '3 的时间线首节点必须是权威首发源',
  );

  console.log('\n=== 3. out_of_context ===');
  for (const line of formatWitnesses(witnesses, sources)) {
    console.log(`- ${line}`);
  }

  await runRuleCase({
    label: 'out_of_context',
    input: '研究已经证实咖啡会致癌。',
    claims: [claim],
    sources,
    groups,
    timelines,
    expectLevel: 'out_of_context',
    expectConfidence: 0.84,
    expectEvidenceState: 'multi',
  });
}

/** 4. 部分属实：既有权威支持又有权威反驳，但不构成明确谣言。 */
async function testPartlyTrue(): Promise<void> {
  const claim = makeClaim('p1', '每天一杯咖啡会让患癌风险增加三成。');
  const sources = [
    makeSource({
      id: 'p1-official',
      claimId: 'p1',
      site: '中国营养学会',
      stance: 'support',
      tier: 'official',
    }),
    makeSource({
      id: 'p1-media',
      claimId: 'p1',
      site: '健康时报网',
      stance: 'refute',
      tier: 'media',
    }),
  ];

  const witnesses = collectWitnesses(claim, sources, []);
  assert.ok(
    witnesses.some((witness) => witness.stance === 'support' && witness.tier === 'official'),
    '4 需要权威支持',
  );
  assert.ok(
    witnesses.some(
      (witness) =>
        witness.stance === 'refute' && (witness.tier === 'official' || witness.tier === 'media'),
    ),
    '4 需要权威反驳',
  );

  console.log('\n=== 4. partly_true ===');
  for (const line of formatWitnesses(witnesses, sources)) {
    console.log(`- ${line}`);
  }

  const verdict = await runRuleCase({
    label: 'partly_true',
    input: '每天一杯咖啡会让患癌风险增加三成。',
    claims: [claim],
    sources,
    groups: [],
    timelines: {},
    expectLevel: 'partly_true',
    expectConfidence: 0.62,
    expectEvidenceState: 'multi',
  });
  assert.notEqual(verdict.level, 'false', '4 不能被误判为明确谣言');

  const item = must(
    verdict.claims.find((candidate) => candidate.claimId === 'p1'),
    '4 缺少 p1 的疑点判决',
  );
  assert.ok(item.conflict, '4 正反都有独立证人，应记录 conflict');
  assert.deepEqual(item.conflict.supportIds, ['p1-official'], '4 的 conflict 支持方不符');
  assert.deepEqual(item.conflict.refuteIds, ['p1-media'], '4 的 conflict 反驳方不符');
  assert.ok(
    item.conflict.resolution.includes('采信支持方'),
    `4 的冲突应按 tier 采信支持方：${item.conflict.resolution}`,
  );
  console.log(`- conflict：${item.conflict.resolution}`);
}

/** 5. 无法证实：零证据 / 只有自媒体 / 来源互冲且无权威依据。 */
async function testUnverified(): Promise<void> {
  console.log('\n=== 5. unverified 与证据三态 ===');

  // 5a. 零来源 → none + 「我不知道」，摘要要交代查了什么、看了多少、为什么确认不了
  const emptyClaim = makeClaim('u0', '咖啡能治百病。');
  const emptyVerdict = await runRuleCase({
    label: 'unverified（零来源）',
    input: '咖啡能治百病。',
    claims: [emptyClaim],
    sources: [],
    groups: [],
    timelines: {},
    expectLevel: 'unverified',
    expectConfidence: 0.1,
    expectEvidenceState: 'none',
  });
  assert.equal(emptyVerdict.headline, '我不知道', '5a 零来源的 headline 必须是「我不知道」');
  assert.ok(
    emptyVerdict.summary.includes('没有取到任何来源'),
    `5a 摘要未交代零来源：${emptyVerdict.summary}`,
  );
  assert.ok(emptyVerdict.summary.includes('咖啡能治百病'), '5a 摘要未列出疑点原文');

  // 5b. 唯一来源链接打不开 → 等同于零证人，摘要要列出检索词、来源数、死链数
  const deadClaim = makeClaim('u-dead', '咖啡能防癌。');
  const deadSources = [
    makeSource({
      id: 'u-dead-official',
      claimId: 'u-dead',
      stance: 'support',
      tier: 'official',
      url: 'https://dead.example.com/u-dead',
      query: '咖啡防癌 官方',
    }),
  ];
  const deadVerdict = await runRuleCase({
    label: 'unverified（来源全部不可达）',
    input: '咖啡能防癌。',
    claims: [deadClaim],
    sources: deadSources,
    groups: [],
    timelines: {},
    expectLevel: 'unverified',
    expectConfidence: 0.1,
    expectEvidenceState: 'none',
  });
  assert.equal(deadSources[0].reachable, false, '5b 不可达来源应写回 reachable=false');
  assert.ok(deadVerdict.summary.includes('「咖啡防癌 官方」'), '5b 摘要未列出检索词');
  assert.ok(deadVerdict.summary.includes('1 条来源'), '5b 摘要未列出来源数量');
  assert.ok(deadVerdict.summary.includes('1 条链接打不开'), '5b 摘要未交代死链');
  console.log(`- 零来源摘要：${emptyVerdict.summary}`);
  console.log(`- 死链摘要：${deadVerdict.summary}`);

  // 5c. 只有 1 个自媒体支持 → single，headline 加提示，置信度不超过 0.5
  const selfOnlyClaim = makeClaim('u1', '咖啡能延寿十年。');
  const selfOnlyVerdict = await runRuleCase({
    label: 'unverified（只有自媒体）',
    input: '咖啡能延寿十年。',
    claims: [selfOnlyClaim],
    sources: [makeSource({ id: 'u1-self', claimId: 'u1', stance: 'support', tier: 'self' })],
    groups: [],
    timelines: {},
    expectLevel: 'unverified',
    expectConfidence: 0.26,
    expectEvidenceState: 'single',
  });
  assert.equal(
    selfOnlyVerdict.headline,
    '仅单一来源，置信度低',
    '5c 单一来源的 headline 必须带提示',
  );
  assert.ok(
    selfOnlyVerdict.summary.startsWith('仅单一来源，置信度低'),
    `5c 摘要未说明单一来源：${selfOnlyVerdict.summary}`,
  );
  assert.ok(selfOnlyVerdict.confidence <= 0.5, '5c 单一来源的置信度不得超过 0.5');
  assert.equal(
    must(selfOnlyVerdict.claims[0], '5c 缺少疑点判决').conflict,
    undefined,
    '5c 单向证据不应创建 conflict',
  );

  // 5d. 两个同 tier 自媒体正反互冲且时间无先后 → conflict 未决，按 unverified
  const conflictClaim = makeClaim('u2', '咖啡会让人失眠。');
  const conflictVerdict = await runRuleCase({
    label: 'unverified（同 tier 互冲且时间无先后）',
    input: '咖啡会让人失眠。',
    claims: [conflictClaim],
    sources: [
      makeSource({ id: 'u2-self-pro', claimId: 'u2', stance: 'support', tier: 'self' }),
      makeSource({ id: 'u2-self-con', claimId: 'u2', stance: 'refute', tier: 'self' }),
    ],
    groups: [],
    timelines: {},
    expectLevel: 'unverified',
    expectConfidence: 0.36,
    expectEvidenceState: 'multi',
  });
  const conflictItem = must(conflictVerdict.claims[0], '5d 缺少疑点判决');
  assert.ok(conflictItem.conflict, '5d 正反都有独立证人，应记录 conflict');
  assert.deepEqual(conflictItem.conflict.supportIds, ['u2-self-pro'], '5d 的 supportIds 不符');
  assert.deepEqual(conflictItem.conflict.refuteIds, ['u2-self-con'], '5d 的 refuteIds 不符');
  assert.ok(
    conflictItem.conflict.resolution.includes('无法判断'),
    `5d 分不出先后时应说明无法判断：${conflictItem.conflict.resolution}`,
  );
  assert.ok(
    conflictItem.summary.includes('互相矛盾'),
    `5d 摘要应如实说明矛盾：${conflictItem.summary}`,
  );
  console.log(`- 冲突未决：${conflictItem.conflict.resolution}`);

  // 5e. 同 tier 但反驳方发布更晚 → 采信反驳方
  const lateClaim = makeClaim('u3', '咖啡会让人失眠。');
  const lateVerdict = await runRuleCase({
    label: 'unverified（同 tier 反驳方更晚）',
    input: '咖啡会让人失眠。',
    claims: [lateClaim],
    sources: [
      makeSource({
        id: 'u3-self-pro',
        claimId: 'u3',
        stance: 'support',
        tier: 'self',
        publishedAt: '2024-01-01T00:00:00.000Z',
      }),
      makeSource({
        id: 'u3-self-con',
        claimId: 'u3',
        stance: 'refute',
        tier: 'self',
        publishedAt: '2024-03-01T00:00:00.000Z',
      }),
    ],
    groups: [],
    timelines: {},
    expectLevel: 'unverified',
    expectConfidence: 0.36,
    expectEvidenceState: 'multi',
  });
  const lateItem = must(lateVerdict.claims[0], '5e 缺少疑点判决');
  assert.ok(lateItem.conflict, '5e 正反都有独立证人，应记录 conflict');
  assert.ok(
    lateItem.conflict.resolution.includes('反驳方发布时间更晚'),
    `5e 应按发布时间采信反驳方：${lateItem.conflict.resolution}`,
  );
  console.log(`- 按时间采信：${lateItem.conflict.resolution}`);

  // 5f. 单一权威反驳仍判 false：只限制置信度，不额外否决判决
  const singleRefuteClaim = makeClaim('u4', '咖啡被证实会致癌。');
  const singleRefuteVerdict = await runRuleCase({
    label: 'false（单一官方反驳）',
    input: '咖啡被证实会致癌。',
    claims: [singleRefuteClaim],
    sources: [makeSource({ id: 'u4-official', claimId: 'u4', stance: 'refute', tier: 'official' })],
    groups: [],
    timelines: {},
    expectLevel: 'false',
    expectConfidence: 0.5,
    expectEvidenceState: 'single',
  });
  assert.equal(
    singleRefuteVerdict.headline,
    '仅单一来源，置信度低',
    '5f 单一来源的 headline 必须带提示',
  );
  assert.equal(
    must(singleRefuteVerdict.claims[0], '5f 缺少疑点判决').conflict,
    undefined,
    '5f 单向证据不应创建 conflict',
  );
}

/** 链接校验：不可达来源不参与判决与引用，三态按可达来源重算。 */
async function testReachability(): Promise<void> {
  console.log('\n=== 链接校验 ===');

  const live = makeSource({
    id: 'r-live',
    claimId: 'r1',
    stance: 'support',
    tier: 'self',
    url: 'https://example.com/live',
  });
  const dead = makeSource({
    id: 'r-dead',
    claimId: 'r1',
    stance: 'support',
    tier: 'official',
    url: 'https://dead.example.com/r-dead',
  });

  const checked = await checkReachability([live, dead]);
  assert.equal(checked[0].reachable, true, '可达链接应标记 reachable=true');
  assert.equal(checked[1].reachable, false, '不可达链接应标记 reachable=false');

  const claim = makeClaim('r1', '咖啡能延寿。');
  const sources = [
    makeSource({ id: 'r-live', claimId: 'r1', stance: 'support', tier: 'self' }),
    makeSource({
      id: 'r-dead',
      claimId: 'r1',
      stance: 'support',
      tier: 'official',
      url: 'https://dead.example.com/r-dead',
    }),
  ];
  const verdict = await runRuleCase({
    label: '链接校验（死链剔除后重算三态）',
    input: '咖啡能延寿。',
    claims: [claim],
    sources,
    groups: [],
    timelines: {},
    expectLevel: 'unverified',
    expectConfidence: 0.26,
    expectEvidenceState: 'single',
  });

  assert.equal(sources[1].reachable, false, 'makeVerdict 应把校验结果写回 sources');
  assert.equal(sources[0].reachable, true, '可达来源应写回 reachable=true');

  const item = must(verdict.claims[0], '链接校验缺少疑点判决');
  assert.ok(!item.citationIds.includes('r-dead'), '死链来源不得出现在 citationIds');
  assert.ok(!item.summary.includes('r-dead'), '死链来源不得被摘要引用');
  assert.equal(item.level, 'unverified', '剔掉唯一权威支持后应回落 unverified');
  console.log(
    `- r-live reachable=${sources[0].reachable}，r-dead reachable=${sources[1].reachable}，citationIds=${JSON.stringify(item.citationIds)}`,
  );
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** 起一个本地 OpenAI 兼容服务，按顺序返回预设 JSON，用来验证引用清洗与截断。 */
async function withStubLlm<T>(replies: StubReply[], run: () => Promise<T>): Promise<T> {
  const queue = [...replies];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const payload = queue.shift();
      if (!payload) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'stub 没有更多回复' } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'stub',
          object: 'chat.completion',
          created: 0,
          model: 'stub-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify(payload) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object', 'stub 服务未拿到端口');
  const saved = {
    base: process.env.LLM_BASE_URL,
    key: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
  };
  process.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.LLM_API_KEY = 'stub-key';
  process.env.LLM_MODEL = 'stub-model';

  try {
    const result = await run();
    assert.equal(queue.length, 0, `stub 仍有 ${queue.length} 条预设回复未被消费`);
    return result;
  } finally {
    restoreEnv('LLM_BASE_URL', saved.base);
    restoreEnv('LLM_API_KEY', saved.key);
    restoreEnv('LLM_MODEL', saved.model);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

/** 6 & 7. 引用清洗与文案限长：依赖模型输出，用本地 stub 注入。 */
async function testCitationsAndLimits(): Promise<void> {
  console.log('\n=== 6 & 7. 引用与文案限长 ===');

  const claim = makeClaim('q1', '这句话有引用编号问题。');
  const sources = [
    makeSource({
      id: 'q1-a1',
      claimId: 'q1',
      site: '国家食品安全风险评估中心',
      stance: 'refute',
      tier: 'official',
    }),
    makeSource({
      id: 'q1-a2',
      claimId: 'q1',
      site: '某自媒体',
      stance: 'support',
      tier: 'self',
    }),
  ];

  const claimSummary = '这句引用有效【s1】。这句引用无效 [s999]。';
  const longHeadline = '这是一条需要被截断的超长标题内容用于验证字数上限';
  const longTitle = '这是一个非常非常非常非常长的辟谣卡标题文本';
  const longBody = '这是一段刻意写得很长很长的辟谣正文'.repeat(5) + '来源：某不存在的站点。';

  const replies: StubReply[] = [
    {
      verdicts: [
        {
          claimId: 'q1',
          level: 'false',
          confidence: 0.9,
          summary: claimSummary,
          citationIds: ['q1-a1', 'q1-a2'],
        },
      ],
    },
    {
      headline: longHeadline,
      summary: '整案摘要引用 [s1]，另附无效 [s999]。',
      rebuttalCard: { title: longTitle, body: longBody },
    },
  ];

  const capture = captureWarnings();
  let verdict: Verdict;
  try {
    verdict = await withStubLlm(replies, () =>
      makeVerdict('这句话有引用编号问题。', [claim], sources, [], {}),
    );
  } finally {
    capture.restore();
  }
  assert.equal(capture.messages.length, 0, 'stub 正常返回时不应发生降级');

  assertVerdict(verdict, sources, '引用清洗');
  const item = must(
    verdict.claims.find((candidate) => candidate.claimId === 'q1'),
    '缺少 q1 的疑点判决',
  );

  assert.equal(
    item.summary,
    '这句引用有效[s1]。这句引用无效。',
    '【s1】未规范为 [s1]，或无效 [s999] 未被删除',
  );
  assert.deepEqual(tokensOf(item.summary), ['s1'], '清洗后的摘要只应保留一个有效引用');
  assert.deepEqual(
    item.citationIds,
    ['q1-a1'],
    'citationIds 只应包含摘要真正引用的来源，未引用的 q1-a2 必须剔除',
  );

  assert.ok(!verdict.summary.includes('s999'), '整案摘要中的无效编号未被删除');
  assert.ok(verdict.summary.includes('[s1]'), '整案摘要中的有效编号应保留');

  assert.notEqual(verdict.headline, longHeadline, '超长 headline 应回落到模板');
  assert.ok(
    charLength(verdict.headline) <= MAX_HEADLINE_CHARS,
    `headline 仍有 ${charLength(verdict.headline)} 字`,
  );

  assert.equal(
    charLength(verdict.rebuttalCard.title),
    MAX_TITLE_CHARS,
    `超长 title 应截断到 ${MAX_TITLE_CHARS} 字`,
  );
  assert.ok(verdict.rebuttalCard.title.endsWith('…'), '截断后的 title 应以省略号收尾');

  assert.ok(
    charLength(verdict.rebuttalCard.body) <= MAX_BODY_CHARS,
    `body 仍有 ${charLength(verdict.rebuttalCard.body)} 字`,
  );
  assert.ok(
    verdict.rebuttalCard.body.endsWith(`来源：${sources[0].site}`),
    `body 应以「来源：${sources[0].site}」收尾：${verdict.rebuttalCard.body}`,
  );

  console.log(`- 疑点摘要：${item.summary}`);
  console.log(`- citationIds：${JSON.stringify(item.citationIds)}`);
  console.log(`- headline：${verdict.headline}（${charLength(verdict.headline)} 字）`);
  console.log(
    `- title：${verdict.rebuttalCard.title}（${charLength(verdict.rebuttalCard.title)} 字）`,
  );
  console.log(
    `- body：${verdict.rebuttalCard.body}（${charLength(verdict.rebuttalCard.body)} 字）`,
  );
}

/** 8. 咖啡缓存回归：打印每个疑点的独立首发源，并核对 c3 的 false 依据。 */
async function testCoffeeRegression(): Promise<void> {
  console.log('\n=== 8. 咖啡缓存回归 ===');

  const caseFile = CaseFileSchema.parse(caseDemo);
  const capture = captureWarnings();
  let verdict: Verdict;
  try {
    verdict = await makeVerdict(
      caseFile.input,
      caseFile.claims,
      caseFile.sources,
      caseFile.groups,
      caseFile.timelines,
    );
  } finally {
    capture.restore();
  }
  assert.equal(capture.messages.length, 2, '咖啡缓存规则路径应降级两次');
  assertVerdict(verdict, caseFile.sources, '咖啡缓存');

  for (const claim of caseFile.claims) {
    const witnesses = collectWitnesses(claim, caseFile.sources, caseFile.groups);
    const item = must(
      verdict.claims.find((candidate) => candidate.claimId === claim.id),
      `咖啡缓存缺少 ${claim.id} 的疑点判决`,
    );

    console.log(`\n## ${claim.id} ${claim.text} → ${item.level} ${item.confidence}`);
    console.log('参与判定的独立首发源：');
    for (const line of formatWitnesses(witnesses, caseFile.sources)) {
      console.log(`- ${line}`);
    }
    console.log(
      `citationIds：${item.citationIds.length > 0 ? item.citationIds.join(', ') : '（无）'}`,
    );

    assertClaimCitations(item.summary, item.citationIds, caseFile.sources, `咖啡缓存 ${claim.id}`);
  }

  const c1 = must(
    verdict.claims.find((item) => item.claimId === 'c1'),
    '咖啡缓存缺少 c1',
  );
  assert.equal(c1.level, 'out_of_context', 'c1 存在同源改写，应判 out_of_context');

  const c2 = must(
    verdict.claims.find((item) => item.claimId === 'c2'),
    '咖啡缓存缺少 c2',
  );
  assert.equal(c2.level, 'false', 'c2 有官方明确反驳，应判 false');
  const c2Refuters = collectWitnesses(
    must(
      caseFile.claims.find((claim) => claim.id === 'c2'),
      '咖啡缓存缺少 c2 疑点',
    ),
    caseFile.sources,
    caseFile.groups,
  ).filter(
    (witness) =>
      witness.stance === 'refute' && (witness.tier === 'official' || witness.tier === 'media'),
  );
  assert.ok(c2Refuters.length >= 1, 'c2 判 false 但缺少 official/media 明确反驳来源');

  const c3Claim = must(
    caseFile.claims.find((claim) => claim.id === 'c3'),
    '咖啡缓存缺少 c3 疑点',
  );
  const c3 = must(
    verdict.claims.find((item) => item.claimId === 'c3'),
    '咖啡缓存缺少 c3',
  );
  const c3Witnesses = collectWitnesses(c3Claim, caseFile.sources, caseFile.groups);
  const c3Refuters = c3Witnesses.filter(
    (witness) =>
      witness.stance === 'refute' && (witness.tier === 'official' || witness.tier === 'media'),
  );

  if (c3.level === 'false') {
    assert.ok(
      c3Refuters.length >= 1,
      'c3 判 false 但列不出任何 official/media 的明确反驳来源，应改回 unverified',
    );
    console.log(
      `\nc3 判 false 的依据：${c3Refuters
        .map(
          (witness) =>
            `[${tokenOf(witness.source.id, caseFile.sources)}] ${witness.source.id}（${witness.tier}）`,
        )
        .join('、')}`,
    );
  } else {
    assert.equal(c3.level, 'unverified', 'c3 未判 false 时应为 unverified');
    console.log('\nc3 未判 false，按规则回落 unverified');
  }

  console.log(
    `\n整案：${verdict.level} ${verdict.confidence}｜evidenceState=${verdict.evidenceState}｜${verdict.headline}`,
  );
}

async function main(): Promise<void> {
  disableLlm();
  const restoreFetch = installFetchStub();

  try {
    await testTrue();
    await testFalse();
    await testOutOfContext();
    await testPartlyTrue();
    await testUnverified();
    await testCitationsAndLimits();
    await testReachability();
    await testCoffeeRegression();
  } finally {
    restoreFetch();
  }

  console.log('\n全部 verdict 断言通过');
}

main().catch((error: unknown) => {
  console.error('verdict 验收失败:', error);
  process.exitCode = 1;
});

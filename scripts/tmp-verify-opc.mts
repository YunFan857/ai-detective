/**
 * 离线验收：搜索预算 / 史料来源分级 / scriptcheck 标签与改写 / 引用编号。
 * 全部通过 fetch 桩完成，不访问真实搜索或大模型。
 */
import assert from 'node:assert/strict';
import { gatherEvidence, getExecutedSearchPlan } from '/Users/yunfanai/vibe_coding/yuanbao_zhentan/lib/pipeline/search';
import { gradeSources } from '/Users/yunfanai/vibe_coding/yuanbao_zhentan/lib/pipeline/grade';
import { makeVerdict } from '/Users/yunfanai/vibe_coding/yuanbao_zhentan/lib/pipeline/verdict';
import { tierByDomain } from '/Users/yunfanai/vibe_coding/yuanbao_zhentan/lib/tiers';
import type {
  CaseEvent,
  Claim,
  Source,
  Tier,
} from '/Users/yunfanai/vibe_coding/yuanbao_zhentan/types/case';

process.env.LLM_BASE_URL = 'http://llm.local/v1';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'test-model';
process.env.YUANBAO_API_KEY = 'test-yuanbao';

const TAG = Date.now().toString(36);
const searchQueries: string[] = [];
const searchResults = new Map<string, { url: string; site: string; title: string; passage: string; date: string }[]>();
const gradingPrompts: string[] = [];

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }) as unknown as Response;
}

function openAiResponse(content: string): Response {
  return jsonResponse({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function pagesFor(query: string) {
  if (query.includes('史料') || query.includes('原文') || query.includes('记载')) {
    return [
      {
        url: `https://ctext.org/shiji/zh?q=${encodeURIComponent(TAG)}`,
        site: 'ctext.org',
        title: '《史记·秦始皇本纪》原文',
        passage: '以水银为百川江河大海，机相灌输，上具天文，下具地理。',
        date: '2020-01-01 00:00:00',
      },
      {
        url: `https://zh.wikisource.org/wiki/shiji?q=${encodeURIComponent(TAG)}`,
        site: 'zh.wikisource.org',
        title: '史记 秦始皇本纪',
        passage: '始皇初即位，穿治郦山。',
        date: '2020-01-02 00:00:00',
      },
    ];
  }
  return [
    {
      url: `https://baike.baidu.com/item/秦始皇陵?q=${encodeURIComponent(TAG)}`,
      site: 'baike.baidu.com',
      title: '秦始皇陵（百度百科）',
      passage: '相传地宫内以水银模拟江河湖海。',
      date: '2021-01-01 00:00:00',
    },
    {
      url: `https://www.zhihu.com/question/1?q=${encodeURIComponent(TAG)}`,
      site: 'zhihu.com',
      title: '秦始皇陵为什么不挖',
      passage: '据说水银含量很高。',
      date: '2021-01-02 00:00:00',
    },
  ];
}

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes('/SearchPro')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { Query?: string };
    const query = body.Query ?? '';
    searchQueries.push(query);
    return jsonResponse({ Response: { Pages: pagesFor(query) } });
  }
  if (url.includes('llm.local')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages?: { role: string; content: string }[];
    };
    const system = body.messages?.[0]?.content ?? '';
    if (system.includes('判断每条来源')) {
      gradingPrompts.push(system);
      const ids = [...system.matchAll(/^id: (.+)$/gm)].map((match) => match[1]);
      return openAiResponse(
        JSON.stringify({
          results: ids.map((id) => ({
            id,
            stance: 'support',
            // 故意返回 self，验证已知域名档位不被模型覆盖
            tier: 'self',
            reason: '史书原文与疑点相符',
          })),
        }),
      );
    }
    return openAiResponse(
      JSON.stringify({
        claims: [],
        overall: { headline: '测试', summary: '', rebuttalCard: { title: '测试', body: '测试' } },
      }),
    );
  }
  return new Response('', { status: 200 }) as unknown as Response;
}) as typeof fetch;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

/* ---------- 1. 每疑点搜索预算 ≤ 3 ---------- */

const claims: Claim[] = [
  { id: 'h1', text: `据《史记》记载，秦始皇陵地宫以水银为百川江河大海${TAG}`, kind: 'other' },
  { id: 'h2', text: `相传秦始皇曾派人寻找长生不老药${TAG}`, kind: 'other' },
];

let chatCalls = 0;
const deps = {
  chat: async (options: { system: string; user?: string }) => {
    chatCalls += 1;
    const text = options.user ?? claims[0].text;
    return {
      pro: [`${text} 史料 原文`, `${text} 记载`, `${text} 出处`],
      con: [`${text} 考证 史学界`, `${text} 辟谣 真实情况`, `${text} 史料 辨伪`],
    };
  },
};

const searchEvents: CaseEvent[] = [];
const sources = await gatherEvidence(claims, (event) => searchEvents.push(event), {
  mode: 'scriptcheck',
  deps,
});

const plan1 = getExecutedSearchPlan(claims[0]);
const plan2 = getExecutedSearchPlan(claims[1]);
check('每个疑点有独立搜索计划', Boolean(plan1 && plan2));
check(
  '默认预算下每疑点实际搜索 ≤ 3 次',
  (plan1?.executed ?? 99) <= 3 && (plan2?.executed ?? 99) <= 3,
  `h1=${plan1?.executed} h2=${plan2?.executed}`,
);
check('每疑点固定 1 pro + 2 con', plan1?.pro.length === 1 && plan1?.con.length === 2);
check(
  'scriptcheck 检索词含史料/考证方向',
  Boolean(plan1?.pro.some((q) => /史料|原文|记载|出处/.test(q))) &&
    Boolean(plan1?.con.some((q) => /考证|辟谣|史学界|真实情况/.test(q))),
  `pro=${JSON.stringify(plan1?.pro)} con=${JSON.stringify(plan1?.con)}`,
);
check(
  '开始搜索时推送 claim_progress=searching',
  claims.every((claim) =>
    searchEvents.some(
      (event) => event.type === 'claim_progress' && event.claimId === claim.id && event.status === 'searching',
    ),
  ),
);
const h1Searches = searchQueries.filter((query) => query.includes(claims[0].text)).length;
const h2Searches = searchQueries.filter((query) => query.includes(claims[1].text)).length;
check('真实发出的搜索请求也未超预算', h1Searches <= 3 && h2Searches <= 3, `h1=${h1Searches} h2=${h2Searches}`);
check('两个疑点共 6 次搜索', searchQueries.length === 6, `${searchQueries.length} 次`);

/* 低预算：perClaimLimit=2 时截断，不挤占其他疑点 */
searchQueries.length = 0;
const lowPlans: (unknown | undefined)[] = [];
await gatherEvidence(claims, () => {}, {
  mode: 'scriptcheck',
  perClaimLimit: 2,
  deps,
  onPlan: (plan) => lowPlans.push(plan),
});
check(
  'perClaimLimit=2 时每疑点只执行 2 次',
  lowPlans.length === 2 &&
    lowPlans.every((plan) => (plan as { executed: number }).executed === 2),
  JSON.stringify(lowPlans.map((plan) => (plan as { executed: number }).executed)),
);
check('预算受限时每疑点仍保留 pro/con 两方向', (() => {
  const first = lowPlans[0] as { pro: string[]; con: string[] } | undefined;
  return Boolean(first && first.pro.length >= 1 && first.con.length >= 1);
})());

/* 模型失败兜底仍带史料方向 */
searchQueries.length = 0;
const fallbackPlans: { pro: string[]; con: string[]; executed: number }[] = [];
await gatherEvidence(claims, () => {}, {
  mode: 'scriptcheck',
  deps: { chat: async () => { throw new Error('模型不可用'); } },
  onPlan: (plan) => fallbackPlans.push(plan),
});
check(
  'scriptcheck 兜底检索词含「史料 原文」',
  fallbackPlans.length === 2 && fallbackPlans.every((plan) => plan.pro[0].includes('史料 原文')),
  JSON.stringify(fallbackPlans[0]?.pro),
);
check(
  '兜底后仍遵守每疑点 ≤ 3 次',
  fallbackPlans.every((plan) => plan.executed <= 3),
  JSON.stringify(fallbackPlans.map((plan) => plan.executed)),
);

/* ---------- 2. 史料类来源可被识别 ---------- */

const officialExpect: [string, string][] = [
  ['https://ctext.org/shiji', 'ctext.org 中国哲学书电子化计划'],
  ['https://www.ctext.org/shiji', 'ctext.org 带 www'],
  ['https://www.dswxyjy.org.cn/article', '中共中央党史和文献研究院'],
  ['http://dangshi.people.com.cn/n1/2020/0101', '人民网党史频道'],
  ['https://www.xuexi.cn/lgpage/detail', '学习强国'],
  ['https://www.dpm.org.cn/collection', '故宫博物院'],
  ['https://www.chnmuseum.cn/zp', '中国国家博物馆'],
  ['http://www.cass.cn/lishi', '中国社科院'],
  ['https://history.fudan.edu.cn/info', '高校历史学系'],
];
for (const [site, label] of officialExpect) {
  check(`${label} → official`, tierByDomain(site) === 'official', String(tierByDomain(site)));
}
check('百度百科 → self', tierByDomain('https://baike.baidu.com/item/秦始皇') === 'self');
check('中文维基百科 → self', tierByDomain('https://zh.wikipedia.org/wiki/秦始皇') === 'self');
check('普通自媒体历史号 → 不误判 official', tierByDomain('https://www.gushiwang123.com/a/1') === null);

const gradedEvents: CaseEvent[] = [];
const graded = await gradeSources(claims, sources, (event) => gradedEvents.push(event), {
  mode: 'scriptcheck',
});
const ctextSource = graded.find((source) => source.site === 'ctext.org');
check('历史疑点能检索到 ctext.org 史料来源', Boolean(ctextSource));
check('史料来源分级为 official，未被模型降级', ctextSource?.tier === 'official', String(ctextSource?.tier));
check(
  'scriptcheck 分级提示包含史书原文/学术论文/博物馆/党史',
  gradingPrompts.length > 0 &&
    /史书原文/.test(gradingPrompts[0]) &&
    /学术论文/.test(gradingPrompts[0]) &&
    /博物馆/.test(gradingPrompts[0]) &&
    /党史/.test(gradingPrompts[0]) &&
    /相传/.test(gradingPrompts[0]),
);
check(
  '每个疑点分级前推送 claim_progress=grading',
  claims.every((claim) =>
    gradedEvents.some(
      (event) => event.type === 'claim_progress' && event.claimId === claim.id && event.status === 'grading',
    ),
  ),
);

/* ---------- 3. scriptLabel / rewrite / 引用编号 ---------- */

function makeSource(options: {
  id: string;
  claimId: string;
  site?: string;
  title?: string;
  snippet?: string;
  url?: string;
  stance: 'support' | 'refute';
  tier: Tier;
}): Source {
  return {
    id: options.id,
    claimId: options.claimId,
    url: options.url ?? `https://example.com/${options.id}`,
    site: options.site ?? `站点 ${options.id}`,
    title: options.title ?? `标题 ${options.id}`,
    snippet: options.snippet ?? `摘要 ${options.id}`,
    publishedAt: '2024-01-01T00:00:00.000Z',
    direction: options.stance === 'refute' ? 'con' : 'pro',
    query: '历史检索词',
    stance: options.stance,
    tier: options.tier,
    reachable: true,
  };
}

const vClaims: Claim[] = [
  { id: 'v-recorded', text: '据《史记》记载，秦始皇陵地宫以水银为百川江河大海。', kind: 'other' },
  { id: 'v-baike', text: '秦始皇陵地宫有水银保护尸体。', kind: 'other' },
  { id: 'v-legend', text: '秦始皇曾经见过长生不老的神仙。', kind: 'other' },
  { id: 'v-fabricated', text: '兵马俑是活人烧制而成的。', kind: 'other' },
  { id: 'v-none', text: '秦始皇陵地宫里有九层妖塔。', kind: 'other' },
  { id: 'v-short', text: '始皇', kind: 'other' },
];

const vSources: Source[] = [
  makeSource({
    id: 'x-ctext',
    claimId: 'v-recorded',
    site: 'ctext.org',
    url: 'https://ctext.org/shiji/qin-benji',
    title: '《史记·秦始皇本纪》原文',
    snippet: '以水银为百川江河大海，机相灌输。',
    stance: 'support',
    tier: 'official',
  }),
  makeSource({
    id: 'x-baike',
    claimId: 'v-baike',
    site: 'baike.baidu.com',
    url: 'https://baike.baidu.com/item/秦始皇陵',
    title: '秦始皇陵（百度百科）',
    snippet: '地宫内水银模拟江河湖海。',
    stance: 'support',
    tier: 'self',
  }),
  makeSource({
    id: 'x-legend',
    claimId: 'v-legend',
    site: 'weixin.qq.com',
    title: '民间相传：秦始皇见神仙',
    snippet: '这是一个民间传说，正史没有记载。',
    stance: 'support',
    tier: 'self',
  }),
  makeSource({
    id: 'x-refute',
    claimId: 'v-fabricated',
    site: 'chnmuseum.cn',
    url: 'https://www.chnmuseum.cn/zp/',
    title: '中国国家博物馆：兵马俑为陶制',
    snippet: '权威考证表明兵马俑均为陶土烧制，并非活人。',
    stance: 'refute',
    tier: 'official',
  }),
  makeSource({
    id: 'x-short',
    claimId: 'v-short',
    site: 'zhihu.com',
    title: '始皇是谁',
    snippet: '一般指秦始皇。',
    stance: 'support',
    tier: 'self',
  }),
];

const plans = new Map([
  ['v-recorded', { executed: 3, pro: ['史料 原文'], con: ['考证 史学界', '辟谣'] }],
  ['v-baike', { executed: 3, pro: ['百度百科'], con: ['考证', '辟谣'] }],
  ['v-legend', { executed: 2, pro: ['传说'], con: ['正史'] }],
  ['v-fabricated', { executed: 3, pro: ['陶俑'], con: ['考证', '辟谣'] }],
  ['v-none', { executed: 3, pro: ['九层妖塔'], con: ['考古', '辟谣'] }],
  ['v-short', { executed: 1, pro: ['始皇'], con: [] }],
]);

const verdict = await makeVerdict(
  '历史文案测试',
  vClaims,
  vSources,
  [],
  {},
  { mode: 'scriptcheck', searchPlans: plans },
);

const byClaim = new Map(verdict.claims.map((item) => [item.claimId, item]));
const labelOf = (id: string) => byClaim.get(id)?.scriptLabel;
check('官方史料支持 → recorded', labelOf('v-recorded') === 'recorded', String(labelOf('v-recorded')));
check('百科单独支持 → 不判 recorded', labelOf('v-baike') === 'doubtful', String(labelOf('v-baike')));
check('自媒体相传 → legend', labelOf('v-legend') === 'legend', String(labelOf('v-legend')));
check('权威明确反驳 → fabricated', labelOf('v-fabricated') === 'fabricated', String(labelOf('v-fabricated')));
check('零证据 → doubtful', labelOf('v-none') === 'doubtful', String(labelOf('v-none')));
check('短句存疑 → doubtful', labelOf('v-short') === 'doubtful', String(labelOf('v-short')));

for (const claim of vClaims) {
  const item = byClaim.get(claim.id);
  assert.ok(item, `缺少 ${claim.id} 判决`);
  const length = [...claim.text].length;
  const max = Math.max(1, Math.floor(length * 1.3));

  if (item.scriptLabel === 'recorded') {
    check(`${claim.id} recorded 不输出 rewrite`, item.rewrite === undefined);
  } else {
    const rewrite = item.rewrite ?? '';
    check(
      `${claim.id} rewrite 不超过原句 1.3 倍`,
      rewrite.length > 0 && [...rewrite].length <= max,
      `rewrite=${rewrite}（${[...rewrite].length}/${max}）`,
    );
    check(`${claim.id} rewrite 不偏离标签`, rewrite.length > 0 && rewrite !== claim.text, rewrite);
  }

  check(
    `${claim.id} searches 写入实际次数`,
    item.searches === (plans.get(claim.id)?.executed ?? 0),
    `${item.searches} vs ${plans.get(claim.id)?.executed ?? 0}`,
  );
}

check(
  '零证据疑点摘要明确说「我不知道」并说明查了什么',
  Boolean(byClaim.get('v-none')?.summary.startsWith('我不知道。')) &&
    /检索|查了/.test(byClaim.get('v-none')?.summary ?? ''),
  byClaim.get('v-none')?.summary,
);

check(
  '总标题为统计口吻',
  verdict.headline === '查证 6 个疑点：正史 1 / 野史 1 / 存疑 3 / 编造 1',
  verdict.headline,
);
check('体检卡标题正确', verdict.rebuttalCard.title === '发布前体检结果', verdict.rebuttalCard.title);
check('头图 body 为体检摘要而非家族群文案', /查证 6 个疑点/.test(verdict.rebuttalCard.body), verdict.rebuttalCard.body);

/* 引用编号只允许来自真实来源 */
const knownIds = new Set(vSources.map((source) => source.id));
const tokenToId = new Map(vSources.map((source, index) => [`s${index + 1}`, source.id]));
let citationOk = true;
for (const item of verdict.claims) {
  for (const id of item.citationIds) {
    if (!knownIds.has(id)) {
      citationOk = false;
      console.log(`  ! ${item.claimId} 引用不存在来源 ${id}`);
    }
  }
  const tokens = [...item.summary.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
  const citedTokens = item.citationIds.map((id) =>
    [...tokenToId.entries()].find(([, sourceId]) => sourceId === id)?.[0],
  );
  if (tokens.length !== citedTokens.length || tokens.some((token, index) => token !== citedTokens[index])) {
    citationOk = false;
    console.log(`  ! ${item.claimId} 摘要编号 ${tokens.join(',')} 与 citationIds ${citedTokens.join(',')} 不一致`);
  }
  if (/【/.test(item.summary)) {
    citationOk = false;
    console.log(`  ! ${item.claimId} 残留全角引用符号`);
  }
  if (/\[s\d+\]/.test(item.rewrite ?? '')) {
    citationOk = false;
    console.log(`  ! ${item.claimId} rewrite 内出现引用编号`);
  }
}
check('所有引用编号可对应真实来源且与 citationIds 一致', citationOk);

/* factcheck 行为不变：不输出 scriptLabel / rewrite / searches */
const factVerdict = await makeVerdict('咖啡测试', [vClaims[0]], [vSources[0]], [], {});
const factItem = factVerdict.claims[0];
check('factcheck 不输出 scriptLabel', factItem.scriptLabel === undefined);
check('factcheck 不输出 rewrite', factItem.rewrite === undefined);
check('factcheck 不输出 searches', factItem.searches === undefined);
check('factcheck 标题保持原逻辑', factVerdict.rebuttalCard.title !== '发布前体检结果', factVerdict.rebuttalCard.title);

console.log(process.exitCode ? '\n存在失败项' : '\n全部离线验收通过');

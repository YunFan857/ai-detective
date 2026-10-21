import {
  CaseEventSchema,
  CaseFileSchema,
  type CaseEvent,
  type CaseFile,
  type Claim,
  type Source,
  type SourceGroup,
  type Stats,
  type TimelineStep,
  type Verdict,
} from '../types/case';

/**
 * 演示用假数据：一起「四天工作制试点」谣言。
 * 所有机构、网址、人名均为虚构，仅用于开发和视觉联调。
 */

const claims: Claim[] = [
  {
    id: 'c1',
    text: '滨海市从 2026 年 1 月起试点四天工作制。',
    kind: 'time',
  },
  {
    id: 'c2',
    text: '滨海市政府已经发布四天工作制试点的正式文件。',
    kind: 'other',
  },
  {
    id: 'c3',
    text: '试点后每周工时从 40 小时降到 32 小时。',
    kind: 'number',
  },
];

const sources: Source[] = [
  {
    id: 'src_official_01',
    claimId: 'c2',
    url: 'https://www.binhai.gov.cn/rsj/notice/20260108.html',
    site: '滨海市人力资源和社会保障局',
    title: '关于网传“四天工作制试点”的辟谣声明',
    snippet: '经核查，我市未发布四天工作制试点文件，网传文件截图系伪造。',
    publishedAt: '2026-01-08T02:30:00.000Z',
    direction: 'con',
    query: '滨海市 四天工作制 试点 官方文件',
    stance: 'refute',
    tier: 'official',
    groupId: 'g1',
    isOrigin: true,
  },
  {
    id: 'src_media_02',
    claimId: 'c1',
    url: 'https://www.binhairibao.com/news/2026/0108/8842.html',
    site: '滨海日报',
    title: '辟谣：我市并无“四天工作制”试点安排',
    snippet: '记者从市人社局获悉，网传文件与截图均不属实，请勿轻信转发。',
    publishedAt: '2026-01-08T04:10:00.000Z',
    direction: 'con',
    query: '滨海市 四天工作制 试点 官方回应',
    stance: 'refute',
    tier: 'media',
  },
  {
    id: 'src_wechat_03',
    claimId: 'c1',
    url: 'https://mp.weixin.qq.com/s/demo-four-day-week',
    site: '职场观察局（微信公众号）',
    title: '重磅！滨海市下月起试点四天工作制，每周只上四天班',
    snippet: '内部文件显示，滨海市将于 2026 年 1 月起在部分单位试点四天工作制。',
    publishedAt: '2026-01-05T01:20:00.000Z',
    direction: 'pro',
    query: '滨海市 四天工作制 试点',
    stance: 'support',
    tier: 'self',
    groupId: 'g2',
    isOrigin: true,
  },
  {
    id: 'src_marketing_04',
    claimId: 'c3',
    url: 'https://www.toutiao.com/article/7300000000000000000/',
    site: '环球职场爆料',
    title: '四天工作制全国推广时间表曝光：每周工时降至 32 小时',
    snippet: '据知情人士透露，试点后每周工时将由 40 小时降至 32 小时，并逐步全国推广。',
    publishedAt: '2026-01-06T03:00:00.000Z',
    direction: 'pro',
    query: '四天工作制 每周 32 小时 全国推广',
    stance: 'support',
    tier: 'marketing',
  },
  {
    id: 'src_aggregator_05',
    claimId: 'c1',
    url: 'https://www.36kr.com/p/demo-four-day-week-repost',
    site: '某资讯聚合号',
    title: '滨海市试点四天工作制，官方文件流出',
    snippet: '本文转载自职场观察局。滨海市将于下月起试点四天工作制。',
    publishedAt: '2026-01-06T09:45:00.000Z',
    direction: 'pro',
    query: '滨海市 四天工作制 文件 流出',
    stance: 'support',
    tier: 'self',
    groupId: 'g2',
    isOrigin: false,
  },
  {
    id: 'src_research_06',
    claimId: 'c1',
    url: 'https://www.labor-research.org.cn/papers/2025/1120-flexible-work.html',
    site: '劳动研究院',
    title: '弹性工时改革：从 40 小时到 32 小时的可能路径',
    snippet: '报告建议有条件地区探索缩短工时试点，但未给出具体城市与时间表。',
    publishedAt: '2025-11-20T06:00:00.000Z',
    direction: 'pro',
    query: '四天工作制 研究报告 缩短工时',
    stance: 'irrelevant',
    tier: 'official',
  },
  {
    id: 'src_forum_07',
    claimId: 'c1',
    url: 'https://www.zhihu.com/question/000000000',
    site: '知乎问答',
    title: '如何看滨海市试点四天工作制？',
    snippet: '匿名用户：听说机关事业单位先试，企业暂时不包含。',
    publishedAt: '2026-01-07T12:00:00.000Z',
    direction: 'pro',
    query: '滨海市 四天工作制 机关事业单位',
    stance: 'support',
    tier: 'unknown',
  },
  {
    id: 'src_self_08',
    claimId: 'c2',
    url: 'https://mp.weixin.qq.com/s/demo-binhai-denial',
    site: '滨海本地通（微信公众号）',
    title: '官方回应“四天工作制”：消息不实',
    snippet: '全文转发市人社局 1 月 8 日辟谣声明，未补充任何新信息。',
    publishedAt: '2026-01-08T06:00:00.000Z',
    direction: 'con',
    query: '滨海市 四天工作制 辟谣',
    stance: 'refute',
    tier: 'self',
    groupId: 'g1',
    isOrigin: false,
  },
  {
    id: 'src_forum_09',
    claimId: 'c3',
    url: 'https://bbs.binhai.example.com/thread/20260107/12345',
    site: '滨海论坛',
    title: '四天工作制是不是每天还是 8 小时？',
    snippet: '那不就是每周 32 小时吗，工资应该不变吧？',
    publishedAt: '2026-01-07T15:20:00.000Z',
    direction: 'pro',
    query: '四天工作制 32 小时 工资',
    stance: 'support',
    tier: 'unknown',
  },
];

const groups: SourceGroup[] = [
  {
    id: 'g1',
    claimId: 'c2',
    originSourceId: 'src_official_01',
    memberIds: ['src_official_01', 'src_self_08'],
    reason: '两篇内容均完整引用滨海市人社局 2026-01-08 辟谣声明，属同源转载。',
  },
  {
    id: 'g2',
    claimId: 'c1',
    originSourceId: 'src_wechat_03',
    memberIds: ['src_wechat_03', 'src_aggregator_05'],
    reason: '后者文首标注“本文转载自职场观察局”，无独立采访与新增证据。',
  },
];

const timelines: Record<string, TimelineStep[]> = {
  c1: [
    {
      sourceId: 'src_research_06',
      publishedAt: '2025-11-20T06:00:00.000Z',
      quote: '报告建议有条件地区探索缩短工时试点，但未给出具体城市与时间表。',
    },
    {
      sourceId: 'src_wechat_03',
      publishedAt: '2026-01-05T01:20:00.000Z',
      quote: '内部文件显示，滨海市将于 2026 年 1 月起在部分单位试点四天工作制。',
      mutation: '把“研究建议”改写成“内部文件已确定”，并补上具体城市与时间。',
    },
    {
      sourceId: 'src_aggregator_05',
      publishedAt: '2026-01-06T09:45:00.000Z',
      quote: '滨海市试点四天工作制，官方文件流出。',
      mutation: '“内部文件”升级为“官方文件流出”，同时删去“部分单位”的限定。',
    },
    {
      sourceId: 'src_forum_07',
      publishedAt: '2026-01-07T12:00:00.000Z',
      quote: '听说机关事业单位先试，企业暂时不包含。',
      mutation: '新增“机关事业单位先行”的细节，信息源降级为匿名用户。',
    },
    {
      sourceId: 'src_official_01',
      publishedAt: '2026-01-08T02:30:00.000Z',
      quote: '经核查，我市未发布四天工作制试点文件，网传文件截图系伪造。',
      mutation: '官方辟谣出现，谣言链条终止。',
    },
  ],
  c3: [
    {
      sourceId: 'src_marketing_04',
      publishedAt: '2026-01-06T03:00:00.000Z',
      quote: '试点后每周工时将由 40 小时降至 32 小时，并逐步全国推广。',
    },
    {
      sourceId: 'src_forum_09',
      publishedAt: '2026-01-07T15:20:00.000Z',
      quote: '那不就是每周 32 小时吗，工资应该不变吧？',
      mutation: '把营销号的推测固化成“每周 32 小时、工资不变”的确定说法。',
    },
  ],
};

const verdict: Verdict = {
  level: 'false',
  confidence: 0.93,
  headline: '“滨海市四天工作制试点”系谣言',
  summary:
    '网传“官方文件”并不存在，滨海市人社局已于 1 月 8 日公开辟谣；所谓“每周 32 小时”来自营销号推算，没有任何官方或研究依据。',
  claims: [
    {
      claimId: 'c1',
      level: 'false',
      confidence: 0.95,
      summary: '市人社局明确否认发布试点文件，网传截图系伪造。',
      citationIds: ['src_official_01', 'src_media_02'],
    },
    {
      claimId: 'c2',
      level: 'false',
      confidence: 0.96,
      summary: '官方声明从未发布相关文件，转载账号也未提供原始文件。',
      citationIds: ['src_official_01', 'src_self_08'],
    },
    {
      claimId: 'c3',
      level: 'unverified',
      confidence: 0.42,
      summary: '“每周 32 小时”仅见于营销号与论坛推测，无官方或研究来源支持。',
      citationIds: ['src_marketing_04', 'src_forum_09'],
    },
  ],
  rebuttalCard: {
    title: '三句话看懂“四天工作制”谣言',
    body: '① 网传文件是伪造截图；② 官方已于 1 月 8 日辟谣；③ “每周 32 小时”是营销号推算，并非政策内容。',
  },
};

const stats: Stats = {
  apiCalls: 7,
  sourcesVisited: 14,
  independentWitnesses: 3,
  durationMs: 18740,
};

const rawCaseFile: CaseFile = {
  id: 'case-20260108-binhai',
  input:
    '网传滨海市从 2026 年 1 月起试点四天工作制，官方已经发文，还说每周工时降到 32 小时，是真的吗？',
  createdAt: '2026-01-08T12:00:00.000Z',
  claims,
  sources,
  groups,
  timelines,
  verdict,
  stats,
};

/** 完整的演示卷宗，已通过 CaseFileSchema 校验。 */
export const mockCaseFile: CaseFile = CaseFileSchema.parse(rawCaseFile);

const rawEvents: unknown[] = [
  { type: 'case', id: rawCaseFile.id, input: rawCaseFile.input },
  { type: 'stage', stage: 'claims', status: 'start', message: '正在拆解消息中的可核查疑点' },
  { type: 'claims', claims },
  { type: 'stage', stage: 'claims', status: 'done', message: '拆出 3 个疑点' },
  { type: 'stage', stage: 'search', status: 'start', message: '围绕疑点进行正反搜证' },
  ...sources.map((source) => ({ type: 'source', source })),
  { type: 'stage', stage: 'search', status: 'done', message: '共获得 9 条候选来源' },
  { type: 'stage', stage: 'grade', status: 'start', message: '按来源类型分级并判断立场' },
  ...sources.map((source) => ({
    type: 'source_update',
    id: source.id,
    patch: { stance: source.stance, tier: source.tier },
  })),
  { type: 'stage', stage: 'grade', status: 'done', message: '完成 9 条来源分级' },
  { type: 'stage', stage: 'cluster', status: 'start', message: '识别同源转载并合并' },
  ...sources
    .filter((source) => source.groupId !== undefined)
    .map((source) => ({
      type: 'source_update',
      id: source.id,
      patch: { groupId: source.groupId, isOrigin: source.isOrigin },
    })),
  { type: 'groups', groups },
  { type: 'stage', stage: 'cluster', status: 'done', message: '合并为 2 个同源组' },
  { type: 'stage', stage: 'trace', status: 'start', message: '按发布时间还原信息变形过程' },
  ...Object.entries(timelines).map(([claimId, steps]) => ({ type: 'timeline', claimId, steps })),
  { type: 'stage', stage: 'trace', status: 'done', message: '完成 2 条时间线' },
  { type: 'stage', stage: 'verdict', status: 'start', message: '综合证据给出五档判决' },
  { type: 'verdict', verdict },
  { type: 'stage', stage: 'verdict', status: 'done', message: '判决完成：谣言' },
  { type: 'stats', stats },
  { type: 'done', caseFile: rawCaseFile },
];

/** 演示事件流，逐条通过 CaseEventSchema 校验。 */
export const mockCaseEvents: CaseEvent[] = rawEvents.map((event) => CaseEventSchema.parse(event));

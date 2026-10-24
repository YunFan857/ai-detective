import { z } from 'zod';

/**
 * 共享契约：结案卷宗与调查事件。
 * 只增不改：修改前必须通知对方，并在 PR 中勾选「是否改契约」。
 */

/** 单条来源对疑点的立场。 */
export const StanceSchema = z.enum(['support', 'refute', 'irrelevant']);
export type Stance = z.infer<typeof StanceSchema>;

/** 来源分级：官方/学术 > 权威媒体 > 自媒体 > 营销号。 */
export const TierSchema = z.enum(['official', 'media', 'self', 'marketing', 'unknown']);
export type Tier = z.infer<typeof TierSchema>;

/** 五档判决：属实 / 部分属实 / 断章取义 / 无法证实 / 谣言。 */
export const VerdictLevelSchema = z.enum([
  'true',
  'partly_true',
  'out_of_context',
  'unverified',
  'false',
]);
export type VerdictLevel = z.infer<typeof VerdictLevelSchema>;

/** 调查模式：消息查证 / 文案体检。 */
export const ModeSchema = z.enum(['factcheck', 'scriptcheck']);
export type Mode = z.infer<typeof ModeSchema>;

/** 输入类型：文本、链接、图片或视频。 */
export const InputTypeSchema = z.enum(['text', 'link', 'image', 'video']);
export type InputType = z.infer<typeof InputTypeSchema>;

/** 疑点风险等级。 */
export const RiskLevelSchema = z.enum(['high', 'medium', 'low']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/** 疑点类别。 */
export const ClaimCategorySchema = z.enum([
  'person',
  'time',
  'place',
  'number',
  'quote',
  'causal',
  'superlative',
  'other',
]);
export type ClaimCategory = z.infer<typeof ClaimCategorySchema>;

/** 文案标签：正史有载 / 野史传说 / 存疑 / 营销号编造。 */
export const ScriptLabelSchema = z.enum(['recorded', 'legend', 'doubtful', 'fabricated']);
export type ScriptLabel = z.infer<typeof ScriptLabelSchema>;

/** 流水线阶段：疑点拆解 → 搜证 → 分级 → 同源合并 → 溯源 → 判决。 */
export const StageSchema = z.enum(['claims', 'search', 'grade', 'cluster', 'trace', 'verdict']);
export type Stage = z.infer<typeof StageSchema>;

/** 从用户输入中拆出的可核查疑点。 */
export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(['person', 'time', 'number', 'causal', 'other']),
  riskLevel: RiskLevelSchema.optional(),
  category: ClaimCategorySchema.optional(),
  signals: z.array(z.string()).optional(),
  consequence: z.string().optional(),
  sentence: z.string().optional(),
  span: z.object({ start: z.number(), end: z.number() }).optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

/** 拆疑点预览；仅有 1–2 个疑点时自动查证。 */
export const ClaimsPreviewSchema = z.object({
  previewId: z.string(),
  mode: ModeSchema,
  input: z.string(),
  inputType: InputTypeSchema,
  inputUrl: z.string().optional(),
  inputTitle: z.string().optional(),
  claims: z.array(ClaimSchema),
  autoRun: z.boolean(),
  pricePerClaim: z.number(),
  createdAt: z.iso.datetime(),
});
export type ClaimsPreview = z.infer<typeof ClaimsPreviewSchema>;

/** 按已查证疑点计费，支持部分退款。 */
export const BillingSchema = z.object({
  pricePerClaim: z.number(),
  checkedClaimIds: z.array(z.string()),
  charged: z.number(),
  refundClaimIds: z.array(z.string()),
  refunded: z.number(),
  reason: z.string().optional(),
});
export type Billing = z.infer<typeof BillingSchema>;

/** 一条检索到的来源。stance / tier / groupId / isOrigin 在分级与合并阶段补齐。 */
export const SourceSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  url: z.string(),
  site: z.string(),
  title: z.string(),
  snippet: z.string(),
  /** ISO 8601 时间。 */
  publishedAt: z.iso.datetime().optional(),
  /** 发布时间状态：known=已取得；missing=已尝试补抓但未取到。 */
  publishedAtStatus: z.enum(['known', 'missing']).optional(),
  /** 该来源来自正方（pro）还是反方（con）检索。 */
  direction: z.enum(['pro', 'con']),
  query: z.string(),
  stance: StanceSchema.optional(),
  tier: TierSchema.optional(),
  groupId: z.string().optional(),
  isOrigin: z.boolean().optional(),
  /** 链接校验结果：不可达的来源不参与判决与引用。 */
  reachable: z.boolean().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

/** 同源组：同一原始出处的多条转载/摘编。 */
export const SourceGroupSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  originSourceId: z.string(),
  memberIds: z.array(z.string()),
  reason: z.string(),
});
export type SourceGroup = z.infer<typeof SourceGroupSchema>;

/** 溯源时间线的一步；mutation 描述与上一步相比如何走样。 */
export const TimelineStepSchema = z.object({
  sourceId: z.string(),
  /** ISO 8601 时间。 */
  publishedAt: z.iso.datetime().optional(),
  quote: z.string(),
  mutation: z.string().optional(),
});
export type TimelineStep = z.infer<typeof TimelineStepSchema>;

/** 单个疑点的判决。 */
export const ClaimVerdictSchema = z.object({
  claimId: z.string(),
  level: VerdictLevelSchema,
  /** 0-1。 */
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  citationIds: z.array(z.string()),
  /** 同一疑点同时存在独立支持与反驳时记录冲突；单向证据不写入。 */
  conflict: z
    .object({
      supportIds: z.array(z.string()),
      refuteIds: z.array(z.string()),
      resolution: z.string(),
    })
    .optional(),
  scriptLabel: ScriptLabelSchema.optional(),
  rewrite: z.string().optional(),
  searches: z.number().optional(),
});
export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;

/** 整案判决与可转发的辟谣卡。 */
export const VerdictSchema = z.object({
  level: VerdictLevelSchema,
  /** 0-1。 */
  confidence: z.number().min(0).max(1),
  /** 独立证人数：≥2 为 multi，1 为 single，0 为 none。 */
  evidenceState: z.enum(['multi', 'single', 'none']).optional(),
  headline: z.string(),
  summary: z.string(),
  claims: z.array(ClaimVerdictSchema),
  rebuttalCard: z.object({
    title: z.string(),
    body: z.string(),
  }),
});
export type Verdict = z.infer<typeof VerdictSchema>;

/** 本次调查的调用与耗时统计。 */
export const StatsSchema = z.object({
  apiCalls: z.number(),
  sourcesVisited: z.number(),
  independentWitnesses: z.number(),
  durationMs: z.number(),
  claimsChecked: z.number().optional(),
});
export type Stats = z.infer<typeof StatsSchema>;

/** 结案卷宗。timelines 以 claimId 为键。 */
export const CaseFileSchema = z.object({
  id: z.string(),
  input: z.string(),
  mode: ModeSchema.optional(),
  previewId: z.string().optional(),
  selectedClaimIds: z.array(z.string()).optional(),
  billing: BillingSchema.optional(),
  /** ISO 8601 时间。 */
  createdAt: z.iso.datetime(),
  claims: z.array(ClaimSchema),
  sources: z.array(SourceSchema),
  groups: z.array(SourceGroupSchema),
  timelines: z.record(z.string(), z.array(TimelineStepSchema)),
  verdict: VerdictSchema.nullable(),
  stats: StatsSchema,
});
export type CaseFile = z.infer<typeof CaseFileSchema>;

/** 调查过程中推送给前端的事件流。 */
export const CaseEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('case'),
    id: z.string(),
    input: z.string(),
  }),
  z.object({
    type: z.literal('stage'),
    stage: StageSchema,
    status: z.enum(['start', 'done']),
    message: z.string(),
  }),
  z.object({
    type: z.literal('claims'),
    claims: z.array(ClaimSchema),
  }),
  z.object({
    type: z.literal('source'),
    source: SourceSchema,
  }),
  z.object({
    type: z.literal('source_update'),
    id: z.string(),
    patch: SourceSchema.partial(),
  }),
  z.object({
    type: z.literal('groups'),
    groups: z.array(SourceGroupSchema),
  }),
  z.object({
    type: z.literal('timeline'),
    claimId: z.string(),
    steps: z.array(TimelineStepSchema),
  }),
  z.object({
    type: z.literal('claim_progress'),
    claimId: z.string(),
    status: z.enum(['queued', 'searching', 'grading', 'done']),
  }),
  z.object({
    type: z.literal('billing'),
    billing: BillingSchema,
  }),
  z.object({
    type: z.literal('verdict'),
    verdict: VerdictSchema,
  }),
  z.object({
    type: z.literal('stats'),
    stats: StatsSchema,
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    recoverable: z.boolean(),
  }),
  z.object({
    type: z.literal('done'),
    caseFile: CaseFileSchema,
  }),
]);
export type CaseEvent = z.infer<typeof CaseEventSchema>;

/**
 * 卷宗 → Markdown 报告。
 * 命令行导出与 /api/report/[id]?format=md 共用，保证两处口径一致。
 */
import type {
  Billing,
  CaseFile,
  Claim,
  ClaimVerdict,
  ScriptLabel,
  Source,
  Tier,
  VerdictLevel,
} from '../types/case';

const LEVEL_LABELS: Record<VerdictLevel, string> = {
  true: '属实',
  partly_true: '部分属实',
  out_of_context: '断章取义',
  unverified: '无法证实',
  false: '谣言',
};

const TIER_LABELS: Record<Tier, string> = {
  official: '官方 / 学术',
  media: '权威媒体',
  self: '自媒体',
  marketing: '营销号',
  unknown: '未分级',
};

const SCRIPT_LABELS: Record<ScriptLabel, string> = {
  recorded: '正史有载',
  legend: '野史传说',
  doubtful: '存疑',
  fabricated: '营销号编造',
};

const STANCE_LABELS = {
  support: '支持',
  refute: '反驳',
  irrelevant: '无关',
} as const;

const MODE_LABELS = {
  factcheck: '消息查证',
  scriptcheck: '文案体检',
} as const;

const LEVEL_ORDER: VerdictLevel[] = [
  'true',
  'partly_true',
  'out_of_context',
  'unverified',
  'false',
];

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** ISO 时间转北京时间；非法值原样返回。 */
function formatTime(value?: string): string {
  if (!value) {
    return '时间未知';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function escapeTitle(title: string): string {
  return title.replace(/([[\]])/g, '\\$1');
}

/** 可点击来源：标题转义，链接用尖括号包裹以兼容括号。 */
function sourceLink(source: Source): string {
  const label = escapeTitle(source.title.trim() || source.url);
  return `[${label}](<${source.url}>)`;
}

function sourceMeta(source: Source): string {
  const parts = [source.site];
  if (source.tier) {
    parts.push(TIER_LABELS[source.tier]);
  }
  if (source.stance) {
    parts.push(STANCE_LABELS[source.stance]);
  }
  if (source.reachable === false) {
    parts.push('链接不可达');
  }
  return parts.filter(Boolean).join(' · ');
}

function blockquote(text: string): string[] {
  return text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd());
}

/** 引用来源列表；没有可用来源时返回一句说明。 */
function citationLines(
  citationIds: string[],
  sourceById: Map<string, Source>,
  indent = '',
): string[] {
  const sources = citationIds
    .map((id) => sourceById.get(id))
    .filter((source): source is Source => Boolean(source));

  if (sources.length === 0) {
    return [`${indent}- 无可用引用来源`];
  }

  return sources.map((source) => `${indent}- ${sourceLink(source)} · ${sourceMeta(source)}`);
}

function sortedSources(sources: Source[]): Source[] {
  return [...sources].sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : Number.MAX_SAFE_INTEGER;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
}

function verdictOf(caseFile: CaseFile, claimId: string): ClaimVerdict | undefined {
  return caseFile.verdict?.claims.find((item) => item.claimId === claimId);
}

function levelLine(level: VerdictLevel, confidence: number): string {
  return `${LEVEL_LABELS[level]}（置信度 ${percent(confidence)}）`;
}

function evidenceLine(caseFile: CaseFile): string {
  const state = caseFile.verdict?.evidenceState;
  if (!state) {
    return '';
  }
  const text =
    state === 'multi' ? '多方独立证据' : state === 'single' ? '单一来源证据' : '无独立证据';
  return `独立证人 ${caseFile.stats.independentWitnesses} 个（${text}）`;
}

/** 未查证疑点：无判决、无引用，或引用来源全部不可达。 */
function uncheckedClaims(caseFile: CaseFile): { claim: Claim; reason: string }[] {
  const sourceById = new Map(caseFile.sources.map((source) => [source.id, source]));
  const result: { claim: Claim; reason: string }[] = [];

  for (const claim of caseFile.claims) {
    const item = verdictOf(caseFile, claim.id);
    if (!item) {
      result.push({ claim, reason: '本次未生成判决结论' });
      continue;
    }
    if (item.citationIds.length === 0) {
      result.push({ claim, reason: '没有可引用的核验来源' });
      continue;
    }
    const cited = item.citationIds
      .map((id) => sourceById.get(id))
      .filter((source): source is Source => Boolean(source));
    if (cited.length === 0 || cited.every((source) => source.reachable === false)) {
      result.push({ claim, reason: '引用来源均不可达' });
    }
  }

  return result;
}

function billingLines(billing?: Billing): string[] {
  if (!billing) {
    return ['本卷宗未记录结算信息。'];
  }

  const lines = [
    `- 单价：${billing.pricePerClaim} 元 / 疑点`,
    `- 查证疑点：${billing.checkedClaimIds.length} 个（${billing.checkedClaimIds.join('、') || '无'}）`,
    `- 扣费：${billing.charged} 元`,
    `- 退款：${billing.refunded} 元${
      billing.refundClaimIds.length > 0 ? `（${billing.refundClaimIds.join('、')}）` : ''
    }`,
  ];
  if (billing.reason) {
    lines.push(`- 说明：${billing.reason}`);
  }
  return lines;
}

function headerLines(caseFile: CaseFile, title: string): string[] {
  const lines = [
    `# ${title}`,
    '',
    `- 案件编号：${caseFile.id}`,
    `- 生成时间：${formatTime(caseFile.createdAt)}`,
    `- 模式：${MODE_LABELS[caseFile.mode ?? 'factcheck']}`,
  ];
  if (caseFile.previewId) {
    lines.push(`- 预览编号：${caseFile.previewId}`);
  }
  lines.push(`- 原始输入：${caseFile.input.replace(/\s+/g, ' ').trim()}`);
  return lines;
}

/** 消息查证：答案 → 疑点结论 → 可点击来源 → 传播时间线。 */
function factcheckReport(caseFile: CaseFile): string {
  const lines = headerLines(caseFile, '查证报告');
  const { verdict } = caseFile;
  const sourceById = new Map(caseFile.sources.map((source) => [source.id, source]));

  lines.push('', '## 结论', '');
  if (!verdict) {
    lines.push('本次未能生成判决结论。');
  } else {
    lines.push(`**${LEVEL_LABELS[verdict.level]}**：${verdict.headline}`, '');
    lines.push(verdict.summary, '');
    const evidence = evidenceLine(caseFile);
    const confidence = `置信度 ${percent(verdict.confidence)}`;
    lines.push(evidence ? `${confidence}；${evidence}` : confidence);
  }

  lines.push('', '## 疑点结论', '');
  if (caseFile.claims.length === 0) {
    lines.push('本次没有可查证的疑点。');
  }
  caseFile.claims.forEach((claim, index) => {
    const item = verdictOf(caseFile, claim.id);
    lines.push(`### ${index + 1}. ${claim.text}`, '');
    if (!item) {
      lines.push('- 判决：本次未生成结论');
    } else {
      lines.push(`- 判决：${levelLine(item.level, item.confidence)}`);
      lines.push(`- 说明：${item.summary}`);
      if (item.conflict) {
        lines.push(
          `- 证据冲突：支持 ${item.conflict.supportIds.length} 条 / 反驳 ${item.conflict.refuteIds.length} 条；${item.conflict.resolution}`,
        );
      }
      lines.push('- 引用来源：');
      lines.push(...citationLines(item.citationIds, sourceById, '  '));
    }
    lines.push('');
  });

  lines.push('## 来源列表', '');
  const usable = sortedSources(caseFile.sources.filter((source) => source.reachable !== false));
  if (usable.length === 0) {
    lines.push('本次没有可引用的来源。');
  } else {
    usable.forEach((source, index) => {
      const claimIds = [...new Set(
        caseFile.sources.filter((item) => item.id === source.id).map((item) => item.claimId),
      )];
      lines.push(
        `${index + 1}. ${sourceLink(source)} · ${sourceMeta(source)}（疑点 ${claimIds.join('、')}）`,
      );
    });
  }

  lines.push('', '## 传播时间线', '');
  let timelineCount = 0;
  for (const claim of caseFile.claims) {
    const steps = caseFile.timelines[claim.id] ?? [];
    if (steps.length === 0) {
      continue;
    }
    timelineCount += 1;
    lines.push(`### ${claim.text}`, '');
    steps.forEach((step, index) => {
      const source = sourceById.get(step.sourceId);
      const label = source ? sourceLink(source) : `来源 ${step.sourceId}`;
      lines.push(`${index + 1}. ${formatTime(step.publishedAt)} · ${label}`);
      lines.push('', ...blockquote(step.quote), '');
      if (step.mutation) {
        lines.push(`- 变形：${step.mutation}`);
      }
    });
    lines.push('');
  }
  if (timelineCount === 0) {
    lines.push('本次未还原出传播时间线。');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** 文案体检：总评 → 逐疑点 → 未查证清单 → 积分结算。 */
function scriptcheckReport(caseFile: CaseFile): string {
  const lines = headerLines(caseFile, '文案体检报告');
  const { verdict } = caseFile;
  const sourceById = new Map(caseFile.sources.map((source) => [source.id, source]));

  lines.push('', '## 总评', '');
  if (!verdict) {
    lines.push('本次未能生成体检结论。');
  } else {
    lines.push(`**${verdict.headline}**（判决：${LEVEL_LABELS[verdict.level]}，置信度 ${percent(verdict.confidence)}）`, '');
    lines.push(verdict.summary, '');
    const counts = new Map<VerdictLevel, number>();
    for (const item of verdict.claims) {
      counts.set(item.level, (counts.get(item.level) ?? 0) + 1);
    }
    const breakdown = LEVEL_ORDER.filter((level) => (counts.get(level) ?? 0) > 0)
      .map((level) => `${LEVEL_LABELS[level]} ${counts.get(level) ?? 0} 个`)
      .join('、');
    lines.push(
      `共查证 ${caseFile.claims.length} 个疑点${breakdown ? `：${breakdown}` : ''}。`,
    );
    const evidence = evidenceLine(caseFile);
    if (evidence) {
      lines.push('', evidence);
    }
  }

  lines.push('', '## 逐疑点', '');
  caseFile.claims.forEach((claim, index) => {
    const item = verdictOf(caseFile, claim.id);
    lines.push(`### ${index + 1}. ${claim.sentence ?? claim.text}`, '');
    if (claim.sentence && claim.sentence !== claim.text) {
      lines.push(`- 核查表述：${claim.text}`);
    }
    if (claim.riskLevel) {
      const risk = claim.riskLevel === 'high' ? '高' : claim.riskLevel === 'medium' ? '中' : '低';
      lines.push(`- 风险等级：${risk}`);
    }
    if (!item) {
      lines.push('- 判决：本次未生成结论', '');
      return;
    }
    lines.push(`- 标签：${item.scriptLabel ? SCRIPT_LABELS[item.scriptLabel] : '未标注'}`);
    lines.push(`- 判决：${levelLine(item.level, item.confidence)}`);
    lines.push(`- 说明：${item.summary}`);
    if (item.rewrite) {
      lines.push(`- 改写建议：${item.rewrite}`);
    }
    lines.push('- 来源：');
    lines.push(...citationLines(item.citationIds, sourceById, '  '));
    lines.push('');
  });

  lines.push('## 未查证疑点', '');
  const unchecked = uncheckedClaims(caseFile);
  if (unchecked.length === 0) {
    lines.push('本次选中的疑点均已生成结论。');
  } else {
    for (const { claim, reason } of unchecked) {
      lines.push(`- ${claim.text} —— ${reason}`);
    }
  }

  lines.push('', '## 本次积分结算', '');
  lines.push(...billingLines(caseFile.billing));

  return `${lines.join('\n').trimEnd()}\n`;
}

/** 卷宗转 Markdown 报告；mode 缺省按消息查证处理。 */
export function caseFileToMarkdown(caseFile: CaseFile): string {
  return caseFile.mode === 'scriptcheck' ? scriptcheckReport(caseFile) : factcheckReport(caseFile);
}

/** 导出文件名：查证报告-<id>.md。 */
export function reportFilename(caseFile: CaseFile): string {
  return `查证报告-${caseFile.id}.md`;
}

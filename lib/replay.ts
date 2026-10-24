/**
 * 卷宗回放：把一份结案卷宗拆成带 delayMs 的事件序列。
 * B 的前端回放与后端 SSE 演示回放共用，保证时间轴与现场一致。
 */
import {
  CaseEventSchema,
  type CaseEvent,
  type CaseFile,
  type Source,
  type VerdictLevel,
} from '../types/case';

/** 一条待回放事件：先等 delayMs 毫秒，再推送 event。 */
export type ReplayEvent = {
  delayMs: number;
  event: CaseEvent;
};

const LEVEL_NAMES: Record<VerdictLevel, string> = {
  true: '属实',
  partly_true: '部分属实',
  out_of_context: '断章取义',
  unverified: '无法证实',
  false: '谣言',
};

/** 各类事件的节奏权重：越"重"的节点停留越久。 */
const WEIGHTS: Record<CaseEvent['type'], number> = {
  case: 0,
  stage: 1,
  claims: 1.2,
  source: 0.5,
  source_update: 0.08,
  groups: 0.8,
  timeline: 0.9,
  claim_progress: 0.2,
  billing: 0.8,
  verdict: 2.2,
  stats: 0.5,
  error: 0.5,
  done: 0.3,
};

/** 只保留已补齐的分级字段，避免把 undefined 写进 patch。 */
function gradePatch(source: Source): Partial<Source> {
  const patch: Partial<Source> = {};
  if (source.stance !== undefined) patch.stance = source.stance;
  if (source.tier !== undefined) patch.tier = source.tier;
  if (source.groupId !== undefined) patch.groupId = source.groupId;
  if (source.isOrigin !== undefined) patch.isOrigin = source.isOrigin;
  if (source.reachable !== undefined) patch.reachable = source.reachable;
  return patch;
}

/** 按卷宗内容生成完整事件序列（不含 delayMs）。 */
function buildEvents(caseFile: CaseFile): CaseEvent[] {
  const events: CaseEvent[] = [];
  const push = (event: CaseEvent): void => {
    events.push(CaseEventSchema.parse(event));
  };

  const { claims, sources, groups, timelines, verdict, stats } = caseFile;
  const tracedCount = claims.filter((claim) => (timelines[claim.id] ?? []).length > 0).length;

  push({ type: 'case', id: caseFile.id, input: caseFile.input });

  push({ type: 'stage', stage: 'claims', status: 'start', message: '正在拆解消息中的可核查疑点' });
  push({ type: 'claims', claims });
  push({ type: 'stage', stage: 'claims', status: 'done', message: `已锁定 ${claims.length} 个疑点` });

  for (const claim of claims) {
    push({ type: 'claim_progress', claimId: claim.id, status: 'queued' });
  }

  push({ type: 'stage', stage: 'search', status: 'start', message: '围绕疑点进行正反搜证' });
  for (const source of sources) {
    push({ type: 'source', source });
  }
  push({
    type: 'stage',
    stage: 'search',
    status: 'done',
    message: `共获得 ${sources.length} 条候选来源`,
  });

  push({ type: 'stage', stage: 'grade', status: 'start', message: '按来源类型分级并判断立场' });
  for (const source of sources) {
    push({ type: 'source_update', id: source.id, patch: gradePatch(source) });
  }
  push({
    type: 'stage',
    stage: 'grade',
    status: 'done',
    message: `完成 ${sources.length} 条来源分级`,
  });

  push({ type: 'stage', stage: 'cluster', status: 'start', message: '识别同源转载并合并' });
  push({ type: 'groups', groups });
  push({ type: 'stage', stage: 'cluster', status: 'done', message: `合并为 ${groups.length} 个同源组` });

  push({ type: 'stage', stage: 'trace', status: 'start', message: '按发布时间还原信息变形过程' });
  for (const claim of claims) {
    push({ type: 'timeline', claimId: claim.id, steps: timelines[claim.id] ?? [] });
  }
  push({ type: 'stage', stage: 'trace', status: 'done', message: `完成 ${tracedCount} 条时间线` });

  push({ type: 'stage', stage: 'verdict', status: 'start', message: '综合证据给出五档判决' });
  if (verdict) {
    for (const claim of claims) {
      push({ type: 'claim_progress', claimId: claim.id, status: 'done' });
    }
    push({ type: 'verdict', verdict });
    push({
      type: 'stage',
      stage: 'verdict',
      status: 'done',
      message: `判决完成：${LEVEL_NAMES[verdict.level]}`,
    });
  } else {
    push({ type: 'stage', stage: 'verdict', status: 'done', message: '未能生成判决结论，本案全额退款' });
  }

  push({ type: 'stats', stats });
  if (caseFile.billing) {
    push({ type: 'billing', billing: caseFile.billing });
  }
  push({ type: 'done', caseFile });

  return events;
}

/**
 * 把卷宗拆成带 delayMs 的事件序列，总时长约 totalMs。
 * 首个事件 delayMs 为 0，其余按事件权重分配；总时长不足事件数时允许出现 0。
 */
export function caseFileToEvents(caseFile: CaseFile, totalMs: number): ReplayEvent[] {
  const events = buildEvents(caseFile);
  const totalWeight = events.reduce((sum, event) => sum + WEIGHTS[event.type], 0);
  const total = Math.max(0, Math.round(totalMs));

  let elapsedWeight = 0;
  let elapsedMs = 0;

  return events.map((event, index) => {
    if (index === 0) {
      return { delayMs: 0, event };
    }
    elapsedWeight += WEIGHTS[event.type];
    const targetMs = totalWeight > 0 ? Math.round((total * elapsedWeight) / totalWeight) : 0;
    const delayMs = Math.max(0, targetMs - elapsedMs);
    elapsedMs = targetMs;
    return { delayMs, event };
  });
}

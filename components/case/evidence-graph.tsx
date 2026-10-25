'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { clsx } from 'clsx';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  getStraightPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import type { Claim, Source, SourceGroup, Stance, TimelineStep } from '@/types/case';
import {
  clipText,
  formatSourceTime,
  sourceSiteLabel,
  sourceSnippetLabel,
  sourceTitleLabel,
} from '@/lib/labels';
import { STEPS, stepById, stepOfTier, type StepId } from '@/lib/steps';

export type EvidenceGraphProps = {
  /** 当前要展示的疑点。 */
  claim: Claim | null;
  /** 该疑点下的来源，按到达顺序排列。 */
  sources: Source[];
  /** 该疑点下的同源组。 */
  groups: SourceGroup[];
  /** 该疑点的溯源时间线，用于把自媒体节点连到上游。 */
  timeline?: TimelineStep[];
  /** 已揭示到第几步。 */
  revealedStep: StepId | 0;
  /** 画布当前查看第几步。 */
  viewStep: StepId | 0;
  /** 判决书里点击引用后要定位的来源 id。 */
  focusSourceId?: string | null;
  /** 同一来源被重复点击时递增，用来重新居中。 */
  focusNonce?: number;
  /** 已结案但一条疑点都没有：画布展示空状态而不是等待态。 */
  empty?: boolean;
};

type ClaimNodeData = {
  kind: 'claim';
  step: 1;
  isCurrent: boolean;
  isNew: boolean;
  text: string;
  meta: string;
};

type SourceNodeData = {
  kind: 'source';
  step: StepId;
  isCurrent: boolean;
  isNew: boolean;
  isFocused: boolean;
  sourceId: string;
  site: string;
  date: string;
  quote: string;
  stance: Stance | null;
};

type GroupNodeData = {
  kind: 'group';
  step: StepId;
  isCurrent: boolean;
  isNew: boolean;
  isFocused: boolean;
  groupId: string;
  count: number;
  memberSites: string;
};

type MoreNodeData = {
  kind: 'more';
  step: StepId;
  isCurrent: boolean;
  isNew: boolean;
  isFocused: boolean;
  moreId: string;
  count: number;
};

type GraphNodeData = ClaimNodeData | SourceNodeData | GroupNodeData | MoreNodeData;
type GraphNode = Node<GraphNodeData, 'evidence'>;
type GraphNodeHandle = NonNullable<GraphNode['handles']>[number];

type GraphEdgeData = {
  step: StepId;
  isCurrent: boolean;
  isNew: boolean;
  dashed: boolean;
};
type GraphEdge = Edge<GraphEdgeData, 'evidence'>;

type CardEntity =
  | { kind: 'source'; id: string; step: StepId; source: Source }
  | {
      kind: 'group';
      id: string;
      step: StepId;
      group: SourceGroup;
      count: number;
      memberSites: string;
    };

type Entity =
  | { kind: 'claim'; id: string; step: 1 }
  | CardEntity
  | {
      kind: 'more';
      id: string;
      step: StepId;
      sourceIds: string[];
    };

type Selection =
  | { kind: 'source'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'more'; id: string };

const CARD_WIDTH = 190;
const CARD_HEIGHT = 84;
const COL_GAP = 24;
const ROW_GAP = 20;
/** 单步最多渲染 8 张卡片（4 行），超出部分折叠成「其余来源」卡片。 */
const MAX_STEP_CARDS = 8;

/**
 * 节点尺寸与连线锚点显式声明：节点对象每次渲染都会重建，
 * React Flow 会因此丢掉 measurement，导致节点 visibility:hidden、连线也拿不到 handle。
 * 这里给出固定的 initialWidth / initialHeight 与 handles，保证首帧即可见、可连线。
 */
const CLAIM_SIZE = { width: 236, height: 104 };
const SOURCE_SIZE = { width: CARD_WIDTH, height: 92 };

const CLAIM_HANDLES = [
  { type: 'source', position: Position.Right, x: CLAIM_SIZE.width, y: CLAIM_SIZE.height / 2 },
] satisfies GraphNodeHandle[];

const SOURCE_HANDLES = [
  { type: 'target', position: Position.Left, x: 0, y: SOURCE_SIZE.height / 2 },
  { type: 'source', position: Position.Right, x: SOURCE_SIZE.width, y: SOURCE_SIZE.height / 2 },
] satisfies GraphNodeHandle[];

/** 每个步骤的固定区域：断言在左中，官方右上，媒体中下，自媒体右中。 */
const REGIONS: Record<StepId, { x: number; y: number; columns: number }> = {
  1: { x: 16, y: 276, columns: 1 },
  2: { x: 350, y: 16, columns: 2 },
  /** 第二步最多 4 行（到 y=412），第三步从 432 起排，避免与第二步重叠。 */
  3: { x: 270, y: 432, columns: 2 },
  4: { x: 780, y: 180, columns: 2 },
};

/** 首次相机范围：预先框住所有步骤区域，避免后续节点出现时再 fitView 造成跳动。 */
const LAYOUT_BOUNDS = { x: -16, y: -16, width: 1216, height: 850 };

const LEGEND = [
  { step: 1, hint: '待核验的断言' },
  { step: 2, hint: '权威信源' },
  { step: 3, hint: '转述扩散' },
  { step: 4, hint: '嫁接放大' },
] as const;

const NEXT_HINTS: Record<StepId, string> = {
  1: '下一步 · 断言将在这里出现',
  2: '下一步 · 官方信源将在这里出现',
  3: '下一步 · 媒体转述将在这里出现',
  4: '下一步 · 自媒体嫁接将在这里出现',
};

const HANDLE_CLASS =
  'pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0';

const BURST_POINTS = Array.from({ length: 20 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 20 - Math.PI / 2;
  const radius = index % 2 === 0 ? 50 : 38;
  return `${(50 + Math.cos(angle) * radius).toFixed(1)},${(50 + Math.sin(angle) * radius).toFixed(1)}`;
}).join(' ');

function sourceStep(source: Source): StepId {
  return stepOfTier(source.tier ?? 'unknown');
}

/** 卡片摘要只保留前 200 字：真实数据的 passage 可达 800 字，无需整段进节点。 */
function quoteOf(source: Source): string {
  return clipText(sourceSnippetLabel(source), 200);
}

function earliestSource(sources: Source[]): Source | null {
  const dated = sources.filter((source): source is Source & { publishedAt: string } => {
    if (!source.publishedAt) return false;
    return !Number.isNaN(Date.parse(source.publishedAt));
  });
  if (dated.length === 0) return null;

  return dated.reduce((earliest, current) =>
    Date.parse(earliest.publishedAt) <= Date.parse(current.publishedAt) ? earliest : current,
  );
}

/** 断言节点的「发布者 · 日期」：优先取最早的自媒体/营销号正方来源。 */
function claimMetaOf(sources: Source[]): string {
  const proSources = sources.filter((source) => source.direction === 'pro');
  const spreaders = proSources.filter(
    (source) =>
      source.tier === 'self' || source.tier === 'marketing' || source.tier === 'unknown',
  );
  const origin = earliestSource(spreaders) ?? earliestSource(proSources) ?? earliestSource(sources);

  if (!origin) return '发布者待核验 · 时间不详';
  return `${sourceSiteLabel(origin)} · ${formatSourceTime(origin.publishedAt, 'month')} 发布`;
}

function buildEntities(claim: Claim, sources: Source[], groups: SourceGroup[]): Entity[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const groupCards: CardEntity[] = [];

  for (const group of groups) {
    const origin = sourceById.get(group.originSourceId);
    if (!origin) continue;

    const memberIds = group.memberIds.filter((id) => id !== group.originSourceId);
    if (memberIds.length === 0) continue;

    const memberSources = memberIds
      .map((id) => sourceById.get(id))
      .filter((source): source is Source => source !== undefined);
    const memberSites = memberSources.map(sourceSiteLabel);
    const summary =
      memberSites.slice(0, 2).join(' / ') + (memberSites.length > 2 ? ' / …' : '');

    /**
     * 组卡归入组内「传得最远」的步骤。
     * 官方原文被自媒体转载时，若按首发来源的等级落位，整组橙色卡片会在同源合并后消失；
     * 取最远等级可让自媒体步保留「同源转载」卡片，同时首发来源仍显示在自己的步骤。
     */
    const step = memberSources.reduce<StepId>(
      (furthest, source) => (sourceStep(source) > furthest ? sourceStep(source) : furthest),
      sourceStep(origin),
    );

    groupCards.push({
      kind: 'group',
      id: `group-${group.id}`,
      step,
      group,
      count: memberIds.length,
      memberSites: summary || '多平台转载',
    });
  }

  const foldedIds = new Set<string>();
  for (const entity of groupCards) {
    if (entity.kind !== 'group') continue;
    for (const id of entity.group.memberIds) {
      if (id !== entity.group.originSourceId) foldedIds.add(id);
    }
  }

  const sourceCards: CardEntity[] = sources
    .filter((source) => !foldedIds.has(source.id))
    .map((source) => ({
      kind: 'source',
      id: `source-${source.id}`,
      step: sourceStep(source),
      source,
    }));

  /** 每个步骤内部按「来源 → 同源组」排序，超过上限时保留前 7 张并折叠其余。 */
  const cardsByStep = new Map<StepId, CardEntity[]>([
    [2, []],
    [3, []],
    [4, []],
  ]);
  for (const entity of sourceCards) cardsByStep.get(entity.step)?.push(entity);
  for (const entity of groupCards) cardsByStep.get(entity.step)?.push(entity);

  const entities: Entity[] = [{ kind: 'claim', id: `claim-${claim.id}`, step: 1 }];
  for (const step of [2, 3, 4] as const) {
    const cards = cardsByStep.get(step) ?? [];
    if (cards.length <= MAX_STEP_CARDS) {
      entities.push(...cards);
      continue;
    }

    const visible = cards.slice(0, MAX_STEP_CARDS - 1);
    const hidden = cards.slice(MAX_STEP_CARDS - 1);
    const hiddenSourceIds = new Set<string>();
    for (const entity of hidden) {
      if (entity.kind === 'source') {
        hiddenSourceIds.add(entity.source.id);
        continue;
      }
      for (const id of entity.group.memberIds) {
        if (id !== entity.group.originSourceId) hiddenSourceIds.add(id);
      }
    }

    entities.push(...visible, {
      kind: 'more',
      id: `more-${claim.id}-${step}`,
      step,
      sourceIds: [...hiddenSourceIds],
    });
  }

  return entities;
}

function buildEdges(
  claim: Claim,
  entities: Entity[],
  timeline: TimelineStep[] | undefined,
  viewStep: StepId | 0,
  revealedStep: StepId | 0,
): GraphEdge[] {
  const claimId = `claim-${claim.id}`;

  /** 来源 → 画面实体：被折叠的转载成员指向同源组卡片。 */
  const entityIdBySource = new Map<string, string>();
  for (const entity of entities) {
    if (entity.kind === 'source') {
      entityIdBySource.set(entity.source.id, entity.id);
    } else if (entity.kind === 'group') {
      for (const id of entity.group.memberIds) {
        if (id !== entity.group.originSourceId) entityIdBySource.set(id, entity.id);
      }
    }
  }

  const upstreamBySource = new Map<string, string>();
  if (timeline) {
    for (let index = 1; index < timeline.length; index += 1) {
      upstreamBySource.set(timeline[index].sourceId, timeline[index - 1].sourceId);
    }
  }

  type EdgeDraft = {
    id: string;
    source: string;
    target: string;
    step: StepId;
    dashed: boolean;
  };
  const candidates: EdgeDraft[] = [];

  for (const entity of entities) {
    if (entity.kind === 'source' && entity.step <= revealedStep) {
      if (entity.step === 4) {
        const upstreamId = upstreamBySource.get(entity.source.id);
        const upstreamEntityId = upstreamId ? entityIdBySource.get(upstreamId) : undefined;

        if (upstreamEntityId) {
          candidates.push({
            id: `edge-up-${upstreamEntityId}-${entity.id}`,
            source: upstreamEntityId,
            target: entity.id,
            step: entity.step,
            dashed: false,
          });
          continue;
        }
      }

      candidates.push({
        id: `edge-claim-${entity.id}`,
        source: claimId,
        target: entity.id,
        step: entity.step,
        dashed: false,
      });
    }

    if (entity.kind === 'group') {
      const originEntityId = entityIdBySource.get(entity.group.originSourceId);
      if (!originEntityId) continue;

      candidates.push({
        id: `edge-group-${entity.group.id}`,
        source: originEntityId,
        target: entity.id,
        step: entity.step,
        dashed: true,
      });
    }

    if (entity.kind === 'more' && entity.step <= revealedStep) {
      candidates.push({
        id: `edge-more-${entity.id}`,
        source: claimId,
        target: entity.id,
        step: entity.step,
        dashed: true,
      });
    }
  }

  const visibleIds = new Set(
    entities.filter((entity) => entity.step <= viewStep).map((entity) => entity.id),
  );

  return candidates
    .filter(
      (edge) =>
        edge.step <= viewStep &&
        visibleIds.has(edge.source) &&
        visibleIds.has(edge.target),
    )
    .map((edge) => {
      const isCurrent = viewStep === revealedStep && edge.step === viewStep;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'evidence',
        data: {
          step: edge.step,
          isCurrent,
          isNew: isCurrent,
          dashed: edge.dashed,
        },
      } satisfies GraphEdge;
    });
}

/**
 * 确定性布局：同一来源在 sources 中的到达序号决定它的槽位，
 * 同源组卡片排在所在步骤所有来源之后。折叠、揭示都不改变已算出的坐标。
 */
function computePositions(sources: Source[], entities: Entity[]): Map<string, XYPosition> {
  const positions = new Map<string, XYPosition>();
  const slotOf = (step: StepId, slot: number): XYPosition => {
    if (step === 1) return { x: REGIONS[1].x, y: REGIONS[1].y };
    const region = REGIONS[step];
    const column = slot % region.columns;
    const row = Math.floor(slot / region.columns);
    return {
      x: region.x + column * (CARD_WIDTH + COL_GAP),
      y: region.y + row * (CARD_HEIGHT + ROW_GAP),
    };
  };

  /** 只有真正渲染成卡片的来源才占槽位；被折叠进同源组的转载不再留出空位。 */
  const renderedSourceIds = new Set(
    entities.flatMap((entity) => (entity.kind === 'source' ? [entity.source.id] : [])),
  );

  const slotBySourceId = new Map<string, number>();
  const sourceSlots: Record<StepId, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const source of sources) {
    if (!renderedSourceIds.has(source.id)) continue;

    const step = sourceStep(source);
    slotBySourceId.set(source.id, sourceSlots[step]);
    sourceSlots[step] += 1;
  }

  const groupSlots: Record<StepId, number> = { ...sourceSlots };

  for (const entity of entities) {
    if (entity.kind === 'source') {
      positions.set(entity.id, slotOf(entity.step, slotBySourceId.get(entity.source.id) ?? 0));
    } else if (entity.kind === 'group') {
      positions.set(entity.id, slotOf(entity.step, groupSlots[entity.step]));
      groupSlots[entity.step] += 1;
    } else if (entity.kind === 'more') {
      positions.set(entity.id, slotOf(entity.step, groupSlots[entity.step]));
      groupSlots[entity.step] += 1;
    } else {
      positions.set(entity.id, slotOf(1, 0));
    }
  }

  return positions;
}

function StanceMark({ stance }: { stance: Stance | null }) {
  if (stance === 'refute') {
    return <span className="text-[11px] font-black text-red">✖ 反驳</span>;
  }
  if (stance === 'support') {
    return <span className="text-[11px] font-black text-brand-dark">✔ 支持</span>;
  }
  return <span className="text-[11px] font-black text-muted">→ 转述</span>;
}

function PopIn({ isNew, children }: { isNew: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      initial={isNew ? (reduced ? { opacity: 0 } : { scale: 0.6, opacity: 0 }) : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 320, damping: 22 }}
    >
      {children}
    </motion.div>
  );
}

function NewSticker({ isNew }: { isNew: boolean }) {
  const reduced = useReducedMotion();

  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute -top-3 -right-2 z-10 grid h-8 w-8 place-items-center"
      initial={isNew ? (reduced ? { opacity: 0 } : { scale: 0, rotate: -100, opacity: 0 }) : false}
      animate={{ scale: 1, rotate: -8, opacity: 1 }}
      transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 340, damping: 16 }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <polygon
          points={BURST_POINTS}
          className="fill-highlight"
          stroke="var(--color-ink)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </svg>
      <span className="relative text-[10px] font-black text-ink">新!</span>
    </motion.span>
  );
}

function ClaimCard({ data }: { data: ClaimNodeData }) {
  return (
    <PopIn isNew={data.isNew}>
      <div className="relative w-[236px] rounded-2xl border-[3px] border-ink bg-card px-4 py-3 shadow-ink">
        <span className="absolute -top-2.5 -right-1.5 rotate-3 rounded-md border-2 border-ink bg-card px-2 py-0.5 text-[10px] font-black text-ink shadow-ink-sm">
          断言
        </span>
        <p
          className="line-clamp-3 pr-8 text-[15px] leading-snug font-black text-ink"
          title={data.text}
        >
          {data.text}
        </p>
        <p className="mt-2 text-[11px] font-bold text-muted">{data.meta}</p>
        <Handle
          type="source"
          position={Position.Right}
          className={HANDLE_CLASS}
          isConnectable={false}
        />
      </div>
    </PopIn>
  );
}

function SourceCard({ data }: { data: SourceNodeData }) {
  const step = stepById(data.step);

  return (
    <PopIn isNew={data.isNew}>
      <div
        className={clsx(
          'relative w-[190px] rounded-xl border-ink px-3 py-2.5',
          data.isFocused && 'outline outline-[6px] outline-offset-2 outline-highlight',
          data.isCurrent ? 'border-4 shadow-ink' : 'border-2 bg-card shadow-ink-sm',
        )}
        style={data.isCurrent ? { backgroundColor: step.soft } : undefined}
      >
        <Handle
          type="target"
          position={Position.Left}
          className={HANDLE_CLASS}
          isConnectable={false}
        />
        <Handle
          type="source"
          position={Position.Right}
          className={HANDLE_CLASS}
          isConnectable={false}
        />
        {data.isCurrent ? <NewSticker isNew={data.isNew} /> : null}

        <p
          className={clsx(
            'truncate text-[11px] leading-tight',
            data.isCurrent ? 'font-black' : 'font-bold',
          )}
          style={{ color: step.color }}
        >
          {data.site} · {data.date}
        </p>
        <p
          className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink"
          title={data.quote}
        >
          {data.quote}
        </p>
        <div className="mt-1.5">
          <StanceMark stance={data.stance} />
        </div>
      </div>
    </PopIn>
  );
}

function GroupCard({ data }: { data: GroupNodeData }) {
  const step = stepById(data.step);

  return (
    <PopIn isNew={data.isNew}>
      <div className="relative w-[190px]">
        <div
          aria-hidden
          className="absolute inset-0 translate-x-2 translate-y-2 rounded-xl border-2 border-ink bg-card"
        />
        <div
          className={clsx(
            'relative rounded-xl border-ink px-3 py-2.5',
            data.isFocused && 'outline outline-[6px] outline-offset-2 outline-highlight',
            data.isCurrent ? 'border-4 shadow-ink' : 'border-2 bg-card shadow-ink-sm',
          )}
          style={data.isCurrent ? { backgroundColor: step.soft } : undefined}
        >
          <Handle
            type="target"
            position={Position.Left}
            className={HANDLE_CLASS}
            isConnectable={false}
          />
          <Handle
            type="source"
            position={Position.Right}
            className={HANDLE_CLASS}
            isConnectable={false}
          />
          {data.isCurrent ? <NewSticker isNew={data.isNew} /> : null}

          <p
            className={clsx(
              'text-[12px] leading-tight',
              data.isCurrent ? 'font-black' : 'font-bold',
            )}
            style={{ color: step.color }}
          >
            同源转载 ×{data.count}
          </p>
          <p className="mt-1 truncate text-[11px] font-bold text-muted">{data.memberSites}</p>
          <p className="mt-1 text-[11px] font-black text-muted">→ 转述</p>
        </div>
      </div>
    </PopIn>
  );
}

function MoreCard({ data }: { data: MoreNodeData }) {
  const step = stepById(data.step);

  return (
    <PopIn isNew={data.isNew}>
      <div className="relative w-[190px]">
        <div
          aria-hidden
          className="absolute inset-0 translate-x-2 translate-y-2 rounded-xl border-2 border-dashed border-ink/60 bg-card"
        />
        <div
          className={clsx(
            'relative rounded-xl border-dashed border-ink px-3 py-2.5',
            data.isFocused && 'outline outline-[6px] outline-offset-2 outline-highlight',
            data.isCurrent ? 'border-4 shadow-ink' : 'border-2 bg-card shadow-ink-sm',
          )}
          style={data.isCurrent ? { backgroundColor: step.soft } : undefined}
        >
          <Handle
            type="target"
            position={Position.Left}
            className={HANDLE_CLASS}
            isConnectable={false}
          />
          <Handle
            type="source"
            position={Position.Right}
            className={HANDLE_CLASS}
            isConnectable={false}
          />
          {data.isCurrent ? <NewSticker isNew={data.isNew} /> : null}

          <p
            className={clsx(
              'text-[12px] leading-tight',
              data.isCurrent ? 'font-black' : 'font-bold',
            )}
            style={{ color: step.color }}
          >
            其余 {data.count} 条来源
          </p>
          <p className="mt-1 truncate text-[11px] font-bold text-muted">画布空间有限，已折叠</p>
          <p className="mt-1 text-[11px] font-black text-muted">→ 点击展开</p>
        </div>
      </div>
    </PopIn>
  );
}

function renderEvidenceCard(data: GraphNodeData) {
  switch (data.kind) {
    case 'claim':
      return <ClaimCard data={data} />;
    case 'source':
      return <SourceCard data={data} />;
    case 'group':
      return <GroupCard data={data} />;
    case 'more':
      return <MoreCard data={data} />;
  }
}

function EvidenceNode({ data }: NodeProps<GraphNode>) {
  return (
    <ErrorBoundary label="证据卡片">
      {renderEvidenceCard(data)}
    </ErrorBoundary>
  );
}

function EvidenceEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<GraphEdge>) {
  const reduced = useReducedMotion();
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const step = stepById(data?.step ?? 1);
  const dashed = Boolean(data?.dashed);
  const isNew = Boolean(data?.isNew) && !reduced;

  return (
    <path
      d={path}
      pathLength={isNew ? 1 : undefined}
      className={clsx('react-flow__edge-path', isNew && 'graph-edge-draw')}
      style={{
        stroke: step.color,
        strokeWidth: data?.isCurrent ? 5 : 3,
        strokeLinecap: 'round',
        strokeDasharray: dashed ? (isNew ? '0.03 0.02' : '7 6') : isNew ? '1' : undefined,
      }}
    />
  );
}

const NODE_TYPES: NodeTypes = { evidence: EvidenceNode };
const EDGE_TYPES: EdgeTypes = { evidence: EvidenceEdge };

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border-2 border-ink bg-card/95 px-3 py-1.5 text-[11px] font-bold shadow-ink-sm">
      {LEGEND.map((item) => {
        const step = STEPS[item.step - 1];

        return (
          <span key={item.step} className="flex items-center gap-1.5 whitespace-nowrap">
            <i
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: step.color }}
              aria-hidden
            />
            <span style={{ color: step.color }}>{step.name}</span>
            <span className="font-normal text-muted">· {item.hint}</span>
          </span>
        );
      })}
    </div>
  );
}

function EvidenceDrawer({
  selection,
  sources,
  groups,
  more,
  onClose,
}: {
  selection: Selection;
  sources: Source[];
  groups: SourceGroup[];
  more?: { step: StepId; sourceIds: string[] };
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const groupById = new Map(groups.map((group) => [group.id, group]));

  const source = selection.kind === 'source' ? sourceById.get(selection.id) : undefined;
  const group = selection.kind === 'group' ? groupById.get(selection.id) : undefined;
  const moreSources = more ? more.sourceIds.flatMap((id) => sourceById.get(id) ?? []) : [];
  const title = group ? '同源转载' : more ? '其余来源' : '来源详情';

  return (
    <motion.aside
      initial={reduced ? { opacity: 0 } : { x: 340, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={reduced ? { opacity: 0 } : { x: 340, opacity: 0 }}
      transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 320, damping: 30 }}
      className="absolute inset-y-0 right-0 z-30 flex w-[330px] flex-col border-l-[3px] border-ink bg-card"
      aria-label="证据详情"
    >
      <header className="flex shrink-0 items-center justify-between border-b-2 border-ink/15 px-4 py-3">
        <h2 className="text-sm font-black text-ink">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="grid h-7 w-7 place-items-center rounded-lg border-2 border-ink bg-card text-xs font-black text-ink shadow-ink-sm transition-transform hover:-translate-y-0.5"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {source ? <SourceDetail source={source} group={groupById.get(source.groupId ?? '')} /> : null}
        {group ? <GroupDetail group={group} sourceById={sourceById} /> : null}
        {more ? <MoreDetail sources={moreSources} step={more.step} /> : null}
        {!source && !group && !more ? (
          <p className="text-xs font-bold text-muted">该节点已不在当前视图中。</p>
        ) : null}
      </div>
    </motion.aside>
  );
}

function SourceDetail({ source, group }: { source: Source; group: SourceGroup | undefined }) {
  const step = stepById(sourceStep(source));

  return (
    <>
      <p className="text-[11px] font-bold" style={{ color: step.color }}>
        {sourceSiteLabel(source)} · {formatSourceTime(source.publishedAt, 'day')}
      </p>
      <h3
        className="line-clamp-3 text-base font-black leading-snug text-ink"
        title={sourceTitleLabel(source)}
      >
        {sourceTitleLabel(source)}
      </h3>
      <p
        className="line-clamp-6 text-xs leading-relaxed text-ink"
        title={clipText(sourceSnippetLabel(source), 300)}
      >
        {sourceSnippetLabel(source)}
      </p>
      <div className="flex items-center gap-2">
        <StanceMark stance={source.stance ?? null} />
      </div>

      {group ? (
        <section className="rounded-xl border-2 border-ink/15 bg-paper p-3">
          <h4 className="text-[11px] font-black text-ink">所属同源组</h4>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{group.reason}</p>
        </section>
      ) : null}

      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-lg border-2 border-ink bg-brand-soft px-3 py-1.5 text-xs font-black text-brand-dark shadow-ink-sm transition-transform hover:-translate-y-0.5"
      >
        打开原文 ↗
      </a>
    </>
  );
}

function MoreDetail({ sources, step }: { sources: Source[]; step: StepId }) {
  const meta = stepById(step);

  return (
    <>
      <p className="text-[11px] font-bold" style={{ color: meta.color }}>
        {meta.name} · 已折叠 {sources.length} 条
      </p>
      <h3 className="text-base font-black leading-snug text-ink">
        其余 {sources.length} 条来源
      </h3>
      <p className="text-[11px] leading-relaxed text-muted">
        为保持画布清晰，这些来源未在图上展开；点击可直接打开原文。
      </p>
      <ul className="space-y-2">
        {sources.map((source) => (
          <li key={source.id} className="rounded-xl border-2 border-ink/15 bg-paper p-2.5">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs font-bold leading-snug text-ink underline underline-offset-2 hover:text-brand-dark"
            >
              {sourceSiteLabel(source)} · {sourceTitleLabel(source)}
            </a>
            <p className="mt-1 text-[11px] text-muted">
              {formatSourceTime(source.publishedAt, 'day')}
            </p>
          </li>
        ))}
        {sources.length === 0 ? (
          <li className="text-[11px] text-muted">暂无可展示的来源。</li>
        ) : null}
      </ul>
    </>
  );
}

function GroupDetail({
  group,
  sourceById,
}: {
  group: SourceGroup;
  sourceById: Map<string, Source>;
}) {
  const origin = sourceById.get(group.originSourceId);
  const members = group.memberIds
    .filter((id) => id !== group.originSourceId)
    .map((id) => sourceById.get(id))
    .filter((source): source is Source => source !== undefined);

  return (
    <>
      <p className="text-[11px] font-bold text-muted">共 {members.length} 条非首发转载</p>
      <h3 className="text-base font-black leading-snug text-ink">
        同源转载 ×{group.memberIds.length - 1}
      </h3>
      <section className="rounded-xl border-2 border-ink/15 bg-paper p-3">
        <h4 className="text-[11px] font-black text-ink">合并理由</h4>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">{group.reason}</p>
      </section>

      {origin ? (
        <div>
          <h4 className="text-[11px] font-black text-ink">首发来源</h4>
          <a
            href={origin.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block text-xs font-bold leading-snug text-brand-dark underline underline-offset-2"
          >
            {sourceSiteLabel(origin)} · {sourceTitleLabel(origin)}
          </a>
        </div>
      ) : null}

      <div>
        <h4 className="text-[11px] font-black text-ink">转载成员</h4>
        <ul className="mt-1 space-y-2">
          {members.map((member) => (
            <li key={member.id}>
              <a
                href={member.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs font-bold leading-snug text-ink underline underline-offset-2 hover:text-brand-dark"
              >
                {sourceSiteLabel(member)} · {sourceTitleLabel(member)}
              </a>
            </li>
          ))}
          {members.length === 0 ? (
            <li className="text-[11px] text-muted">暂无可展示的转载成员。</li>
          ) : null}
        </ul>
      </div>
    </>
  );
}

function EvidenceGraphInner({
  claim,
  sources,
  groups,
  timeline,
  revealedStep,
  viewStep,
  focusSourceId,
  focusNonce,
  empty = false,
}: EvidenceGraphProps) {
  const flow = useReactFlow<GraphNode, GraphEdge>();
  const reduced = useReducedMotion();
  const hasFitRef = useRef(false);
  const handledFocusRef = useRef<number | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  // 「已出现」记录放在 state 里的可变集合：渲染时只读，effect 里登记，避免渲染期改 ref。
  const [seenNodes] = useState(() => new Set<string>());
  const [seenEdges] = useState(() => new Set<string>());

  const entities = useMemo(
    () => (claim ? buildEntities(claim, sources, groups) : []),
    [claim, sources, groups],
  );
  const claimMeta = useMemo(() => (claim ? claimMetaOf(sources) : ''), [claim, sources]);
  // 坐标由 sources 的到达顺序一次性确定，此后不再变化。
  const positions = useMemo(() => computePositions(sources, entities), [sources, entities]);

  /** 引用来源可能被折叠进同源组卡片，定位时统一换算成画面实体。 */
  const focusEntityId = useMemo(() => {
    if (!focusSourceId) return null;

    for (const entity of entities) {
      if (entity.kind === 'source' && entity.source.id === focusSourceId) return entity.id;

      if (
        entity.kind === 'group' &&
        entity.group.originSourceId !== focusSourceId &&
        entity.group.memberIds.includes(focusSourceId)
      ) {
        return entity.id;
      }

      if (entity.kind === 'more' && entity.sourceIds.includes(focusSourceId)) {
        return entity.id;
      }
    }

    return null;
  }, [entities, focusSourceId]);

  const visibleEntities = entities.filter((entity) => entity.step <= viewStep);

  const moreSelection = useMemo(() => {
    if (selection?.kind !== 'more') return null;
    const entity = entities.find((item) => item.kind === 'more' && item.id === selection.id);
    return entity?.kind === 'more' ? { step: entity.step, sourceIds: entity.sourceIds } : null;
  }, [entities, selection]);

  const nodes = visibleEntities.map((entity): GraphNode => {
    const isCurrent = viewStep === revealedStep && entity.step === viewStep;
    const isNew = isCurrent && !seenNodes.has(entity.id);
    const position = positions.get(entity.id) ?? { x: 0, y: 0 };

    if (entity.kind === 'claim') {
      return {
        id: entity.id,
        type: 'evidence',
        position,
        draggable: false,
        selectable: false,
        initialWidth: CLAIM_SIZE.width,
        initialHeight: CLAIM_SIZE.height,
        handles: CLAIM_HANDLES,
        ariaLabel: `待核验的断言：${claim?.text ?? ''}`,
        data: {
          kind: 'claim',
          step: 1,
          isCurrent,
          isNew,
          text: claim?.text ?? '',
          meta: claimMeta,
        },
      };
    }

    if (entity.kind === 'source') {
      return {
        id: entity.id,
        type: 'evidence',
        position,
        draggable: false,
        selectable: false,
        initialWidth: SOURCE_SIZE.width,
        initialHeight: SOURCE_SIZE.height,
        handles: SOURCE_HANDLES,
        ariaLabel: `来源：${sourceSiteLabel(entity.source)}`,
        data: {
          kind: 'source',
          step: entity.step,
          isCurrent,
          isNew,
          isFocused: entity.id === focusEntityId,
          sourceId: entity.source.id,
          site: sourceSiteLabel(entity.source),
          date: formatSourceTime(entity.source.publishedAt, 'month'),
          quote: quoteOf(entity.source),
          stance: entity.source.stance ?? null,
        },
      };
    }

    if (entity.kind === 'more') {
      return {
        id: entity.id,
        type: 'evidence',
        position,
        draggable: false,
        selectable: false,
        initialWidth: SOURCE_SIZE.width,
        initialHeight: SOURCE_SIZE.height,
        handles: SOURCE_HANDLES,
        ariaLabel: `其余 ${entity.sourceIds.length} 条来源`,
        data: {
          kind: 'more',
          step: entity.step,
          isCurrent,
          isNew,
          isFocused: entity.id === focusEntityId,
          moreId: entity.id,
          count: entity.sourceIds.length,
        },
      };
    }

    return {
      id: entity.id,
      type: 'evidence',
      position,
      draggable: false,
      selectable: false,
      initialWidth: SOURCE_SIZE.width,
      initialHeight: SOURCE_SIZE.height,
      handles: SOURCE_HANDLES,
      ariaLabel: `同源转载 ${entity.count} 条`,
      data: {
        kind: 'group',
        step: entity.step,
        isCurrent,
        isNew,
        isFocused: entity.id === focusEntityId,
        groupId: entity.group.id,
        count: entity.count,
        memberSites: entity.memberSites,
      },
    };
  });

  const edges = useMemo(
    () =>
      claim
        ? buildEdges(claim, entities, timeline, viewStep, revealedStep).map((edge) => ({
            ...edge,
            data: edge.data
              ? {
                  ...edge.data,
                  isNew:
                    edge.data.isCurrent && !seenEdges.has(edge.id),
                }
              : edge.data,
          }))
        : [],
    [claim, entities, timeline, viewStep, revealedStep, seenEdges],
  );

  useEffect(() => {
    if (viewStep !== revealedStep) return;
    for (const node of visibleEntities) seenNodes.add(node.id);
    for (const edge of edges) seenEdges.add(edge.id);
  }, [viewStep, revealedStep, visibleEntities, edges, seenNodes, seenEdges]);

  useEffect(() => {
    if (!flowReady || hasFitRef.current) return;
    hasFitRef.current = true;
    // 从判决书跳转进来时直接把镜头交给节点定位，避免先全图再跳。
    if (focusEntityId) return;
    void flow.fitBounds(LAYOUT_BOUNDS, { padding: 0.08, duration: reduced ? 0 : 260 });
  }, [flow, flowReady, reduced, focusEntityId]);

  // 判决书引用 → 画布定位：居中到目标节点，并保留荧光描边。
  useEffect(() => {
    if (!flowReady || !focusEntityId || focusNonce === undefined) return;
    if (handledFocusRef.current === focusNonce) return;
    handledFocusRef.current = focusNonce;

    const position = positions.get(focusEntityId);
    if (!position) return;

    void flow.setCenter(position.x + CARD_WIDTH / 2, position.y + CARD_HEIGHT / 2, {
      zoom: 1.15,
      duration: reduced ? 0 : 420,
    });
  }, [flow, flowReady, focusEntityId, focusNonce, positions, reduced]);

  const nextStep = (revealedStep > 0 ? Math.min(revealedStep + 1, 4) : 1) as StepId;
  const showNext =
    claim !== null && revealedStep > 0 && revealedStep < 4 && viewStep === revealedStep;

  return (
    <section
      aria-label="证据图谱画布"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] border-[3px] border-ink bg-canvas"
    >
      <div className="relative min-h-0 flex-1">
        <ReactFlow<GraphNode, GraphEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          className="h-full w-full bg-canvas"
          onInit={() => setFlowReady(true)}
          onNodeClick={(_, node) => {
            if (node.data.kind === 'source') {
              setSelection({ kind: 'source', id: node.data.sourceId });
            } else if (node.data.kind === 'group') {
              setSelection({ kind: 'group', id: node.data.groupId });
            } else if (node.data.kind === 'more') {
              setSelection({ kind: 'more', id: node.data.moreId });
            }
          }}
          onPaneClick={() => setSelection(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={14}
            size={1.2}
            color="var(--color-paper-deep)"
          />

          {showNext ? (
            <ViewportPortal>
              <div
                className="pointer-events-none absolute"
                style={{ transform: `translate(${REGIONS[nextStep].x}px, ${REGIONS[nextStep].y}px)` }}
              >
                <div
                  className="flex h-[84px] items-center justify-center rounded-xl border-2 border-dashed border-muted/60 bg-card/50 px-4 text-center text-[11px] font-bold text-muted"
                  style={{ width: CARD_WIDTH }}
                >
                  {NEXT_HINTS[nextStep]}
                </div>
              </div>
            </ViewportPortal>
          ) : null}
        </ReactFlow>

        {!claim ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            {empty ? (
              <div className="flex max-w-[320px] flex-col items-center gap-2 text-center">
                <DetectiveMascot mood="yawn" className="w-[104px] -rotate-3" />
                <p className="rounded-xl border-2 border-dashed border-ink/25 bg-card/90 px-5 py-3 text-sm font-black text-ink">
                  这条消息没有可核查的事实
                </p>
                <p className="text-xs font-bold text-muted">
                  试试补充具体的人物、时间、数字或因果，再重新立案
                </p>
              </div>
            ) : (
              <p className="rounded-xl border-2 border-dashed border-ink/25 bg-card/75 px-5 py-3 text-xs font-bold text-muted">
                等待拆解疑点…
              </p>
            )}
          </div>
        ) : null}

        <Legend />

        <AnimatePresence>
          {selection && claim ? (
            <EvidenceDrawer
              key={`${selection.kind}-${selection.id}`}
              selection={selection}
              sources={sources}
              groups={groups}
              more={moreSelection ?? undefined}
              onClose={() => setSelection(null)}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}

/**
 * 证据图谱：疑点断言、分级来源、同源转载与溯源关系。
 * 坐标只增不改，按步骤揭示；点击卡片可在右侧查看详情。
 */
export function EvidenceGraph(props: EvidenceGraphProps) {
  return (
    <ReactFlowProvider>
      <EvidenceGraphInner key={props.claim?.id ?? 'empty'} {...props} />
    </ReactFlowProvider>
  );
}

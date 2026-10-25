'use client';

import { useEffect, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import { motion, useReducedMotion } from 'framer-motion';
import { DetectiveAnimation } from '@/components/case/detective-animation';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { LinkIcon } from '@/components/ui/icons';
import { billingSettlementText } from '@/lib/credits-format';
import { DIRECTION_LABELS, sourceSiteLabel, verdictLabel } from '@/lib/labels';
import { STEPS, stepOfTier, type StepId } from '@/lib/steps';
import type { InvestigationState } from '@/lib/use-investigation';
import type { StepRevealResult } from '@/lib/use-step-reveal';
import type { Stage, Tier } from '@/types/case';

export type ProgressFeedProps = {
  /** 案件来源：链接立案时为域名，文本立案为「消息原文」。 */
  sourceLabel: string;
  /** 链接立案时的文章标题，取首条来源标题兜底。 */
  sourceTitle?: string;
  /** 图片立案时的截图缩略图（data URL）。 */
  sourceImage?: string;
  state: InvestigationState;
  reveal: StepRevealResult;
  /** 本地积分模式：charged=已预占；demo=演示不扣；unconfirmed=未经首页预占。 */
  creditsMode: 'charged' | 'demo' | 'unconfirmed';
};

const STEP_INDEX = ['①', '②', '③', '④'] as const;

/** 阶段 → 默认播报分组；消息里点名来源类型时以来源类型为准。 */
const STEP_OF_STAGE: Record<Stage, StepId> = {
  claims: 1,
  search: 1,
  grade: 2,
  cluster: 4,
  trace: 2,
  verdict: 4,
};

type BubbleKind = 'stage' | 'source' | 'groups' | 'error';

type Bubble = {
  id: string;
  at: number;
  kind: BubbleKind;
  text: string;
  /** 绿色标签里的元宝搜索参数。 */
  query?: string;
  /** 合并同一秒的多个来源时用。 */
  sites?: string[];
};

type GroupedBubbles = Record<StepId, Bubble[]>;

function formatClock(offsetMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(offsetMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function stepOfStageMessage(stage: Stage, message: string): StepId {
  if (/自媒体|营销|洗稿/.test(message)) return 4;
  if (/官方|学术/.test(message)) return 2;
  if (/媒体/.test(message)) return 3;
  return STEP_OF_STAGE[stage];
}

function stepOfSourceTier(tier: Tier | undefined): StepId {
  return tier ? stepOfTier(tier) : 4;
}

/** 把事件流按四个办案步骤归组，并合并同一秒找到的多个来源。 */
function buildGroups(state: InvestigationState): GroupedBubbles {
  const grouped: GroupedBubbles = { 1: [], 2: [], 3: [], 4: [] };
  const mergedSources = new Map<string, Bubble>();
  let lastStep: StepId = 1;

  for (const [index, entry] of state.feed.entries()) {
    switch (entry.type) {
      case 'stage': {
        const step = stepOfStageMessage(entry.stage, entry.message);
        grouped[step].push({
          id: `stage-${index}`,
          at: entry.at,
          kind: 'stage',
          text: entry.message,
        });
        lastStep = step;
        break;
      }

      case 'source': {
        const source = state.sourcesById[entry.source.id] ?? entry.source;
        const site = sourceSiteLabel(source);
        const step = stepOfSourceTier(source.tier);
        const mergeKey = `${step}-${Math.floor(entry.at / 1000)}`;
        const merged = mergedSources.get(mergeKey);

        if (merged) {
          const sites = merged.sites ?? [];
          if (!sites.includes(site)) {
            merged.sites = [...sites, site];
            merged.text = `🔍 找到证人：${merged.sites.join('、')}`;
          }
        } else {
          const bubble: Bubble = {
            id: `source-${entry.source.id}-${index}`,
            at: entry.at,
            kind: 'source',
            text: `🔍 找到证人：${site}`,
            query: `元宝搜索 · ${DIRECTION_LABELS[source.direction]} · ${source.query}`,
            sites: [site],
          };
          grouped[step].push(bubble);
          mergedSources.set(mergeKey, bubble);
        }

        lastStep = step;
        break;
      }

      case 'groups': {
        const group = entry.groups.find((item) => item.memberIds.length > 1);
        if (!group) break;

        const origin = state.sourcesById[group.originSourceId];
        const step = stepOfSourceTier(origin?.tier);
        grouped[step].push({
          id: `groups-${group.id}-${index}`,
          at: entry.at,
          kind: 'groups',
          text: `识破洗稿！${group.memberIds.length} 篇同源转载 🙃`,
        });
        lastStep = step;
        break;
      }

      case 'error':
        grouped[lastStep].push({
          id: `error-${index}`,
          at: entry.at,
          kind: 'error',
          text: `⚠️ 线索中断：${entry.message}`,
        });
        break;
    }
  }

  return grouped;
}

/** 搜索、查证、合并信源期间：跑步动画只在这几段出现。 */
function isProcessing(state: InvestigationState): boolean {
  if (state.status !== 'running') return false;
  for (let index = state.feed.length - 1; index >= 0; index -= 1) {
    const entry = state.feed[index];
    if (entry.type !== 'stage') continue;
    return (
      entry.status === 'start' &&
      (entry.stage === 'search' || entry.stage === 'grade' || entry.stage === 'cluster')
    );
  }
  return false;
}

/**
 * 左栏「办案实况」：按四个办案步骤分组播报。
 * 组头点击与底部步骤条一致；新气泡逐条弹出，播报始终不跟随疑点页签切换。
 */
export function ProgressFeed({
  sourceLabel,
  sourceTitle,
  sourceImage,
  state,
  reveal,
  creditsMode,
}: ProgressFeedProps) {
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);

  const grouped = useMemo(() => buildGroups(state), [state]);
  const bubbleCount = useMemo(
    () => Object.values(grouped).reduce((total, list) => total + list.length, 0),
    [grouped],
  );

  const startedAt = state.startedAt ?? state.feed[0]?.at ?? null;
  const clock = (at: number) => formatClock(at - (startedAt ?? at));

  /** 搜索 / 查证 / 合并信源期间（以最后一条 stage 事件为准）才让侦探跑起来。 */
  const processing = isProcessing(state);
  /** 最新一条播报：跑步动画只跟这一条，同一时刻只有一处。 */
  const latest = useMemo(() => {
    let found: { step: StepId; id: string; at: number } | null = null;
    for (const step of STEPS) {
      const bubbles = grouped[step.id];
      const last = bubbles[bubbles.length - 1];
      if (!last) continue;
      if (!found || last.at >= found.at) found = { step: step.id, id: last.id, at: last.at };
    }
    return found;
  }, [grouped]);
  /** 最新条目已揭示时动画跟在气泡旁；还没揭示时先挂在所在步骤的标题上。 */
  const anchorVisible = latest !== null && reveal.revealedStep >= latest.step;
  const runKey = `${state.startedAt ?? state.feed[0]?.at ?? 0}-${latest?.step ?? 0}`;

  // 新播报到达后自动滚到底部；尊重减少动态偏好。
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [bubbleCount, reduceMotion, state.status]);

  return (
    <aside
      aria-label={`办案实况，已记录 ${state.feed.length} 条播报`}
      className="comic-card flex w-[300px] shrink-0 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-ink/15 px-3 py-2.5">
        <span aria-hidden>🎙️</span>
        <h2 className="text-sm font-black">办案实况</h2>
      </div>

      <div className="mx-3 mt-2 shrink-0 rounded-lg border-2 border-ink/20 bg-paper px-2.5 py-1.5 text-[11px]">
        <div className="flex items-center gap-1.5 text-muted">
          {sourceImage ? (
            <img
              src={sourceImage}
              alt="截图立案原图"
              className="h-8 w-8 shrink-0 rounded border-2 border-ink object-cover"
            />
          ) : (
            <LinkIcon className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="shrink-0">案件来源</span>
          <span aria-hidden>·</span>
          <span className="truncate font-bold text-ink">{sourceLabel}</span>
        </div>
        {sourceTitle ? (
          <p
            title={sourceTitle}
            className="mt-1 line-clamp-2 text-[10px] leading-4 font-bold text-muted"
          >
            {sourceTitle}
          </p>
        ) : null}
        <p
          className={clsx(
            'mt-1.5 rounded border px-1.5 py-0.5 text-[9px] leading-4 font-black',
            creditsMode === 'charged'
              ? 'border-brand bg-brand-soft text-brand-dark'
              : creditsMode === 'demo'
                ? 'border-ink/20 bg-gray-soft text-muted'
                : 'border-orange bg-orange-soft text-orange',
          )}
        >
          {creditsMode === 'charged'
            ? '本地演示积分 · 结案按 billing 扣减 / 退回'
            : creditsMode === 'demo'
              ? '演示卷宗 · 演示不扣积分'
              : '未经首页积分预占 · 本次不扣本地积分'}
        </p>
      </div>

      {creditsMode === 'charged' && state.status === 'done' && state.billing ? (
        <div className="mx-3 mt-2 shrink-0 rounded-lg border-2 border-brand bg-brand-soft px-2.5 py-1.5 text-[10px] leading-4 font-bold text-ink">
          <p className="font-black text-brand-dark">积分结算 · 本地演示</p>
          <p>{billingSettlementText(state.billing)}</p>
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {STEPS.map((step) => {
          const revealed = reveal.revealedStep >= step.id;
          const current = reveal.viewStep === step.id;
          const running = reveal.isRunning(step.id);
          const selectable = revealed || (reveal.pace === 'manual' && running);
          const bubbles = grouped[step.id];

          return (
            <section
              key={step.id}
              className={clsx(
                'rounded-xl border-[3px] p-2 transition-colors',
                current ? 'border-ink shadow-ink-sm' : 'border-transparent',
              )}
              style={current ? { backgroundColor: step.soft } : undefined}
            >
              <button
                type="button"
                onClick={() => reveal.setViewStep(step.id)}
                disabled={!selectable}
                aria-current={current ? 'step' : undefined}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left',
                  selectable ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <i
                  className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-ink"
                  style={{ backgroundColor: revealed ? step.color : 'var(--color-gray-soft)' }}
                  aria-hidden
                />
                <span
                  className={clsx(
                    'text-sm',
                    revealed ? 'font-black text-ink' : 'font-bold text-muted',
                  )}
                >
                  {STEP_INDEX[step.id - 1]} {step.name}
                </span>
                {processing && latest?.step === step.id && !anchorVisible ? (
                  <DetectiveAnimation
                    clip="running"
                    loop
                    playKey={runKey}
                    size={56}
                    className="ml-auto"
                  />
                ) : running ? (
                  <span className="text-[10px] font-bold whitespace-nowrap text-muted">
                    · 进行中…
                  </span>
                ) : null}
              </button>

              {revealed ? (
                <div className="mt-2 ml-1.5 space-y-2 pl-1">
                  {bubbles.map((bubble) => {
                    const isAnchor = processing && latest?.id === bubble.id;
                    return (
                      <motion.div
                        key={bubble.id}
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                        transition={{ duration: reduceMotion ? 0.15 : 0.22, ease: 'easeOut' }}
                        className="relative flex items-start gap-1.5"
                      >
                        <span
                          className={clsx(
                            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-ink bg-brand-soft',
                            isAnchor && 'invisible',
                          )}
                        >
                          <DetectiveMascot variant="avatar" className="h-7 w-7 -translate-y-0.5" />
                        </span>

                        <div
                          className={clsx(
                            'min-w-0 flex-1 rounded-xl border-2 px-2 py-1.5 text-[11px] leading-4 font-bold shadow-ink-sm',
                            bubble.kind === 'error'
                              ? 'border-orange bg-orange-soft text-orange'
                              : bubble.kind === 'groups'
                                ? 'border-ink bg-beige text-ink'
                                : 'border-ink bg-card text-ink',
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="rounded-full border border-ink bg-brand px-1.5 py-0.5 text-[9px] leading-none font-black tracking-wide text-white">
                              {clock(bubble.at)}
                            </span>
                            {bubble.query ? (
                              <span className="max-w-full truncate rounded border border-brand bg-brand-soft px-1 py-0.5 text-[9px] leading-none font-black text-brand-dark">
                                {bubble.query}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 break-words">{bubble.text}</p>
                        </div>

                        {/* 最新处理中条目旁循环播放；只挂在这一条上，避免满屏都在跑。 */}
                        {isAnchor ? (
                          <DetectiveAnimation
                            clip="running"
                            loop
                            playKey={runKey}
                            size={56}
                            className="absolute top-1/2 left-2 -translate-x-1/2 -translate-y-1/2"
                          />
                        ) : null}
                      </motion.div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 ml-1.5 space-y-2 pl-1" aria-hidden>
                  <div className="h-3 w-[88%] rounded bg-gray-soft" />
                  <div className="h-3 w-[64%] rounded bg-gray-soft" />
                </div>
              )}
            </section>
          );
        })}

        {state.status === 'done' ? (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            transition={{ duration: reduceMotion ? 0.15 : 0.22, ease: 'easeOut' }}
            className="rounded-xl border-[3px] border-ink bg-brand px-3 py-2.5 text-sm font-black text-white shadow-ink-sm"
          >
            <span className="mr-1 tracking-wide">{clock(state.closedAt ?? startedAt ?? 0)}</span>
            结案：{state.verdict ? verdictLabel(state.verdict.level) : '待补充'}！
          </motion.div>
        ) : null}
      </div>
    </aside>
  );
}

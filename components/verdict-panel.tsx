'use client';

import { AnimatePresence, motion, useAnimation, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetectiveAnimation } from '@/components/case/detective-animation';
import { MutationTimeline } from '@/components/mutation-timeline';
import { ComicButton } from '@/components/ui/comic-button';
import { VerdictBadge } from '@/components/ui/verdict-badge';
import {
  sourceSiteLabel,
  sourceTitleLabel,
  VERDICT_STAMP_FILL,
  verdictLabel,
} from '@/lib/labels';
import { stepOfTier, type StepId } from '@/lib/steps';
import type { Claim, Source, TimelineStep, Verdict } from '@/types/case';

export type VerdictPanelProps = {
  /** 卡片是否展开。 */
  open: boolean;
  /** 未结案时为 null，组件不渲染任何判决占位。 */
  verdict: Verdict | null;
  /** 全部疑点，用于把分项判决还原成疑点原文。 */
  claims: Claim[];
  /** 全部来源，用于解析 summary 里的引用并按站点缩写展示。 */
  sourcesById: Record<string, Source>;
  /** 来源到达顺序，`[s12]` 这类编号按它兜底定位。 */
  sourceOrder: string[];
  /** mini 时间线要展示的溯源步骤。 */
  timeline: TimelineStep[];
  onClose: () => void;
  /** 点击引用或时间线格子时，收起卡片并定位到画布中的来源。 */
  onSelectSource: (sourceId: string, stepId: StepId) => void;
  /** 底部「生成辟谣卡片」；未传入时退回复制辟谣文案。 */
  onGenerateDebunkCard?: () => void;
  /** 底部「打开结案卷宗」；未传入时按钮置灰。 */
  onOpenCaseFile?: () => void;
};

const CARD_ANIMATION_MS = 220;

/** 印章的锯齿边：13 个尖角，和判决色一起使用。 */
const STAMP_POINTS = (() => {
  const teeth = 13;
  return Array.from({ length: teeth * 2 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / (teeth * 2) - Math.PI / 2;
    const radius = index % 2 === 0 ? 50 : 39;
    return `${(50 + Math.cos(angle) * radius).toFixed(2)},${(50 + Math.sin(angle) * radius).toFixed(2)}`;
  }).join(' ');
})();

const CITATION_SEGMENT = /(\[[^\]]+\])/g;
const FEEDBACK_MS = 1800;

/** 站点缩写：域名取首段，中文站点取前四个字。 */
export function siteAbbreviation(source: Pick<Source, 'site' | 'url'>): string {
  const label = sourceSiteLabel(source);
  const primary = label.split(/[(（·｜\s]/)[0]?.trim() || label.trim();
  const host = primary.replace(/^www\./i, '');

  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)) {
    return host.split('.')[0] ?? host;
  }

  return Array.from(primary).slice(0, 4).join('');
}

/**
 * 引用 token → 来源。
 * 依次尝试：完整 id、`s12` / `src_12` / `12` 的数字后缀、来源到达序号。
 */
function buildCitationResolver(
  sourcesById: Record<string, Source>,
  sourceOrder: readonly string[],
): (token: string) => Source | undefined {
  return (token) => {
    const compact = token.trim().replace(/^\[|\]$/g, '').trim();
    if (!compact) return undefined;

    if (sourcesById[compact]) return sourcesById[compact];

    const numbered = /^(?:s|src|来源)?[\s_-]*(\d+)$/i.exec(compact);
    if (!numbered) return undefined;

    const number = Number(numbered[1]);
    if (!Number.isInteger(number) || number < 1) return undefined;

    const bySuffix = sourceOrder.find((id) => new RegExp(`[_-]0*${number}$`).test(id));
    if (bySuffix) return sourcesById[bySuffix];

    const byIndex = sourceOrder[number - 1];
    return byIndex ? sourcesById[byIndex] : undefined;
  };
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒时退回 textarea + execCommand。
    }
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'true');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(area);
  }
}

/** 把 verdict.claims 里引用到的来源整理成可粘贴的出处清单。 */
function buildCitationText(verdict: Verdict, sourcesById: Record<string, Source>): string {
  const ids = new Set<string>();
  for (const claim of verdict.claims) {
    for (const id of claim.citationIds) ids.add(id);
  }

  const lines = Array.from(ids)
    .map((id) => sourcesById[id])
    .filter((source): source is Source => Boolean(source))
    .map(
      (source) =>
        `· ${sourceSiteLabel(source)}：${sourceTitleLabel(source)}\n  ${source.url}`,
    );

  const head = `【${verdictLabel(verdict.level)}】${verdict.headline}`;
  return lines.length > 0
    ? `${head}\n\n主要出处：\n${lines.join('\n')}`
    : `${head}\n\n暂无可复制的出处。`;
}

function CitationBadge({
  source,
  onSelect,
}: {
  source: Source;
  onSelect: (source: Source) => void;
}) {
  return (
    <button
      type="button"
      title={sourceTitleLabel(source)}
      aria-label={`查看出处：${sourceSiteLabel(source)} · ${sourceTitleLabel(source)}`}
      onClick={() => onSelect(source)}
      className="mx-0.5 inline-flex translate-y-[-1px] items-baseline rounded border border-blue bg-blue-soft px-1 py-0.5 align-baseline text-[10px] leading-none font-black text-blue transition-colors hover:bg-blue hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
    >
      {siteAbbreviation(source)}
    </button>
  );
}

function SummaryText({
  summary,
  resolve,
  onSelect,
}: {
  summary: string;
  resolve: (token: string) => Source | undefined;
  onSelect: (source: Source) => void;
}) {
  return (
    <p className="text-sm leading-6 text-ink/80">
      {summary.split(CITATION_SEGMENT).map((part, index) => {
        const source = /^\[[^\]]+\]$/.test(part) ? resolve(part) : undefined;

        if (source) {
          return <CitationBadge key={`${source.id}-${index}`} source={source} onSelect={onSelect} />;
        }

        return <span key={index}>{part}</span>;
      })}
    </p>
  );
}

/** 爆炸形印章：从画面外压下来，落定时触发一次轻抖。 */
function VerdictStamp({ verdict, onLanded }: { verdict: Verdict; onLanded: () => void }) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      aria-label={`判决结论：${verdictLabel(verdict.level)}`}
      className="relative grid h-[168px] w-[228px] place-items-center"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 2, rotate: -26 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -6 }}
      transition={
        reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 320, damping: 15, mass: 0.9 }
      }
      onAnimationComplete={onLanded}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <polygon
          points={STAMP_POINTS}
          className={VERDICT_STAMP_FILL[verdict.level]}
          stroke="var(--color-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
      <span className="huazi huazi-ink relative max-w-[78%] text-center text-[26px] leading-none">
        {verdictLabel(verdict.level)}！
      </span>
    </motion.div>
  );
}

function VerdictDialog({
  verdict,
  claims,
  sourcesById,
  sourceOrder,
  timeline,
  onClose,
  onSelectSource,
  onGenerateDebunkCard,
  onOpenCaseFile,
}: Omit<VerdictPanelProps, 'open' | 'verdict'> & { verdict: Verdict }) {
  const reduced = useReducedMotion();
  const shake = useAnimation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const feedbackTimer = useRef<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const percent = Math.round(verdict.confidence * 100);
  /** 疑点为 0：后端仍会返回一份判决，但判决书需要说清「没有可核查的事实」。 */
  const noFacts = claims.length === 0 && verdict.claims.length === 0;
  const resolve = useMemo(
    () => buildCitationResolver(sourcesById, sourceOrder),
    [sourcesById, sourceOrder],
  );
  const claimTextById = useMemo(
    () => new Map(claims.map((claim) => [claim.id, claim.text])),
    [claims],
  );

  const notify = useCallback((message: string) => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    setFeedback(message);
    feedbackTimer.current = window.setTimeout(() => {
      feedbackTimer.current = null;
      setFeedback(null);
    }, FEEDBACK_MS);
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    };
  }, []);

  const handleStampLanded = () => {
    if (reduced) return;
    void shake.start(
      { x: [0, -6, 6, -4, 3, 0], y: [0, 3, -2, 2, -1, 0] },
      { duration: 0.42, ease: 'easeInOut' },
    );
  };

  const handleSelect = (source: Source) => {
    onSelectSource(source.id, stepOfTier(source.tier ?? 'unknown'));
  };

  const handleCopy = async () => {
    const ok = await copyText(buildCitationText(verdict, sourcesById));
    notify(ok ? '已复制出处' : '复制失败，请手动选择');
  };

  const handleGenerate = async () => {
    if (onGenerateDebunkCard) {
      onGenerateDebunkCard();
      return;
    }

    const { title, body } = verdict.rebuttalCard;
    const ok = await copyText(`${title}\n\n${body}`);
    notify(ok ? '辟谣文案已复制' : '复制失败，请手动选择');
  };

  const generateLabel = feedback === '辟谣文案已复制' ? '✓ 辟谣文案已复制' : '📤 生成辟谣卡片';
  const copyLabel =
    feedback === '已复制出处' || feedback === '复制失败，请手动选择'
      ? feedback === '已复制出处'
        ? '✓ 已复制出处'
        : '复制失败'
      : '📋 复制出处';

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : CARD_ANIMATION_MS / 1000 }}
    >
      <motion.button
        type="button"
        tabIndex={-1}
        aria-label="关闭判决书"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-scrim"
      />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="verdict-panel-title"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
        transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 300, damping: 26 }}
        className="relative z-10 flex max-h-[92vh] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[24px] border-[3px] border-ink bg-card shadow-ink-lg"
      >
        <motion.div animate={shake} className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-ink/15 px-5 py-3">
            <h2 id="verdict-panel-title" className="flex items-center gap-2 text-lg font-black">
              <span aria-hidden>📜</span>
              判决书
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="rounded-full border-2 border-ink bg-card px-3 py-1 text-xs font-black shadow-ink-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
            >
              收起 ×
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col items-center">
              <VerdictStamp verdict={verdict} onLanded={handleStampLanded} />
            </div>

            <h3 className="mt-2 text-center text-[24px] leading-snug font-black text-ink">
              <span className="relative isolate inline-block">
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0.5 -z-10 h-2.5 -rotate-1 rounded-sm bg-brand/35"
                />
                {noFacts ? '这条消息没有可核查的事实' : verdict.headline}
              </span>
            </h3>

            <div className="mt-4 flex items-center gap-2.5">
              <span className="shrink-0 text-[11px] font-black text-muted">置信度</span>
              <div className="relative h-3.5 min-w-0 flex-1 overflow-hidden rounded-full border-2 border-ink bg-paper">
                <motion.div
                  className="stripe-bar h-full"
                  initial={{ width: reduced ? `${percent}%` : 0 }}
                  animate={{ width: `${percent}%` }}
                  transition={{ duration: reduced ? 0 : 0.6, ease: 'easeOut', delay: 0.15 }}
                />
              </div>
              <span className="shrink-0 text-sm font-black tabular-nums text-ink">{percent}%</span>
            </div>

            <div className="mt-3">
              <SummaryText
                summary={verdict.summary}
                resolve={resolve}
                onSelect={handleSelect}
              />
            </div>

            {verdict.claims.length > 1 ? (
              <section className="mt-4 space-y-2" aria-label="各疑点分项判决">
                {verdict.claims.map((claimVerdict) => {
                  const text = claimTextById.get(claimVerdict.claimId);
                  if (!text) return null;

                  return (
                    <div
                      key={claimVerdict.claimId}
                      className="rounded-xl border-2 border-ink/15 bg-paper px-3 py-2"
                    >
                      <div className="flex items-start gap-2">
                        <VerdictBadge level={claimVerdict.level} size="sm" />
                        <p className="min-w-0 flex-1 text-xs leading-5 font-black text-ink">{text}</p>
                      </div>
                      <p
                        className="mt-1 line-clamp-3 text-[11px] leading-5 text-muted"
                        title={claimVerdict.summary}
                      >
                        {claimVerdict.summary}
                      </p>
                    </div>
                  );
                })}
              </section>
            ) : null}

            <div className="mt-4">
              <MutationTimeline
                steps={timeline}
                sourcesById={sourcesById}
                variant="mini"
                onSelectSource={onSelectSource}
              />
            </div>
          </div>

          <footer className="shrink-0 border-t-2 border-ink/15 px-5 py-3">
            <div className="grid grid-cols-3 gap-2">
              <ComicButton
                variant="brand"
                size="sm"
                onClick={() => void handleGenerate()}
                className="w-full px-2 whitespace-nowrap"
              >
                {generateLabel}
              </ComicButton>

              <ComicButton
                variant="white"
                size="sm"
                onClick={() => void handleCopy()}
                className="w-full px-2 whitespace-nowrap"
              >
                {copyLabel}
              </ComicButton>

              <ComicButton
                variant="white"
                size="sm"
                onClick={onOpenCaseFile}
                disabled={!onOpenCaseFile}
                title={onOpenCaseFile ? undefined : '结案卷宗页开发中'}
                className="w-full px-2 whitespace-nowrap"
              >
                📁 打开结案卷宗
              </ComicButton>
            </div>
          </footer>
        </motion.div>
      </motion.section>

      {/* 递报告：判决书出现后站在卡片右侧，播完停在末帧；每次打开报告重播一次。 */}
      <div className="pointer-events-none absolute top-1/2 left-[calc(50%+352px)] z-20 hidden -translate-y-1/2 xl:block">
        <DetectiveAnimation clip="report" size={200} playKey={verdict.headline} />
      </div>
    </motion.div>
  );
}

/**
 * 结案判决书弹层：第 5 步揭示时自动弹出一次，之后可由「结案！」按钮再次打开。
 * 未结案时不渲染任何占位。
 */
export function VerdictPanel(props: VerdictPanelProps) {
  return (
    <AnimatePresence>
      {props.open && props.verdict ? (
        <VerdictDialog key="verdict-dialog" {...props} verdict={props.verdict} />
      ) : null}
    </AnimatePresence>
  );
}

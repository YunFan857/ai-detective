'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toPng } from 'html-to-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComicButton } from '@/components/ui/comic-button';
import {
  sourceSiteLabel,
  sourceTitleLabel,
  TIER_META,
  VERDICT_META,
  verdictLabel,
} from '@/lib/labels';
import type { Source, Tier, Verdict } from '@/types/case';

/** 分享卡设计尺寸：竖版 3:4，导出 2 倍后为 2160×2880。 */
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1440;
const PIXEL_RATIO = 2;
const MAX_SOURCES = 3;
const FEEDBACK_MS = 3000;

/** 出处排序：官方/学术 > 权威媒体 > 自媒体 > 营销号 > 未知。 */
const TIER_ORDER: Record<Tier, number> = {
  official: 0,
  media: 1,
  self: 2,
  marketing: 3,
  unknown: 4,
};

/**
 * 印章锯齿边：13 个尖角的爆炸形。
 * 用 clip-path 画在 HTML 元素上，而不是 SVG polygon：
 * html-to-image 不会把 SVG 子元素的 class 样式带进 foreignObject，clip-path 可以。
 */
const STAMP_CLIP_PATH = (() => {
  const teeth = 13;
  const points = Array.from({ length: teeth * 2 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / (teeth * 2) - Math.PI / 2;
    const radius = index % 2 === 0 ? 50 : 39;
    const x = (50 + Math.cos(angle) * radius).toFixed(2);
    const y = (50 + Math.sin(angle) * radius).toFixed(2);
    return `${x}% ${y}%`;
  });

  return `polygon(${points.join(', ')})`;
})();

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地生成时间，精确到分钟。 */
function formatGeneratedAt(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 文件名去掉系统不允许的字符，并限制长度。 */
function buildFileName(headline: string): string {
  const safe = headline
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 36);

  return `查证-${safe || '结案'}.png`;
}

/**
 * 取最有权威的 2–3 条出处。
 * 先按来源等级排序；同等级时优先 verdict.claims 引用过的来源，再按到达顺序。
 */
function pickAuthoritativeSources(
  verdict: Verdict,
  sourcesById: Record<string, Source>,
  sourceOrder: readonly string[],
): Source[] {
  const cited = new Set(verdict.claims.flatMap((claim) => claim.citationIds));

  return sourceOrder
    .map((id) => sourcesById[id])
    .filter((source): source is Source => Boolean(source))
    .map((source, index) => ({ source, index }))
    .sort((left, right) => {
      const tierDelta =
        TIER_ORDER[left.source.tier ?? 'unknown'] - TIER_ORDER[right.source.tier ?? 'unknown'];
      if (tierDelta !== 0) return tierDelta;

      const citedDelta = Number(cited.has(right.source.id)) - Number(cited.has(left.source.id));
      if (citedDelta !== 0) return citedDelta;

      return left.index - right.index;
    })
    .slice(0, MAX_SOURCES)
    .map(({ source }) => source);
}

export type ShareCardProps = {
  verdict: Verdict;
  /** 已按权威度挑好的出处，最多 3 条。 */
  sources: Source[];
  generatedAt: Date;
};

/**
 * 1080×1440 竖版辟谣卡：适合手机转发。
 * 主色跟随判决档位，正文按设计尺寸 40px 排版，缩小展示后长辈也能看清。
 */
export function ShareCard({ verdict, sources, generatedAt }: ShareCardProps) {
  const meta = VERDICT_META[verdict.level];

  return (
    <article
      aria-label={`查证结果：${verdictLabel(verdict.level)}`}
      className="relative flex h-[1440px] w-[1080px] flex-col overflow-hidden bg-card text-ink"
    >
      <div aria-hidden className={`absolute inset-x-0 top-0 h-[18px] ${meta.solid}`} />
      <div aria-hidden className="paper-dots absolute inset-0 opacity-30" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-[56px] pt-[46px] pb-[42px]">
        <header className="flex shrink-0 items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <span className="grid h-[64px] w-[64px] place-items-center rounded-[18px] border-[4px] border-ink bg-brand text-white shadow-ink-sm">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                className="h-[34px] w-[34px]"
                aria-hidden
              >
                <circle cx="10.5" cy="10.5" r="6.3" />
                <path d="m15.5 15.5 4.7 4.7" />
              </svg>
            </span>
            <p className="text-[30px] leading-none font-black tracking-[0.02em]">
              AI 侦探社 <span className="text-muted">·</span> 查证结果
            </p>
          </div>

          <span
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border-[3px] px-[20px] py-[8px] text-[26px] font-black tracking-wide ${meta.bg} ${meta.text} ${meta.border}`}
          >
            <i className={`h-[14px] w-[14px] rounded-full ${meta.dot}`} aria-hidden />
            {meta.label}
          </span>
        </header>

        <div className="mt-[10px] flex shrink-0 items-center justify-center">
          <div className="relative grid h-[230px] w-[330px] place-items-center">
            <div
              aria-hidden
              className="absolute inset-0 scale-[1.06] bg-ink"
              style={{ clipPath: STAMP_CLIP_PATH }}
            />
            <div
              aria-hidden
              className={`absolute inset-0 ${meta.solid}`}
              style={{ clipPath: STAMP_CLIP_PATH }}
            />
            <span className="huazi huazi-ink relative text-[54px]">
              {verdictLabel(verdict.level)}！
            </span>
          </div>
        </div>

        <div className="mt-[14px] shrink-0">
          <h1 className="line-clamp-2 text-center text-[54px] leading-[1.14] font-black text-ink">
            {verdict.rebuttalCard.title}
          </h1>
          <div
            aria-hidden
            className={`mx-auto mt-[10px] h-[8px] w-[132px] -rotate-1 rounded-full ${meta.solid}`}
          />
        </div>

        <div
          className={`mt-[18px] shrink-0 rounded-[24px] border-[4px] border-ink px-[32px] py-[22px] shadow-ink-sm ${meta.bg}`}
        >
          <p className="line-clamp-4 text-[40px] leading-[1.5] text-ink">
            {verdict.rebuttalCard.body}
          </p>
        </div>

        <section
          className="mt-[20px] flex min-h-0 flex-1 flex-col overflow-hidden"
          aria-label="最权威的出处"
        >
          <div className="flex shrink-0 items-baseline justify-between gap-4">
            <h2 className="flex items-center gap-2 text-[30px] font-black tracking-wide">
              <span
                aria-hidden
                className={`h-[13px] w-[13px] rotate-45 border-[3px] border-ink ${meta.solid}`}
              />
              最权威的出处
            </h2>
            <span className="text-[22px] font-bold text-muted">按来源等级排序</span>
          </div>

          {sources.length > 0 ? (
            <ul className="mt-[12px] shrink-0 space-y-[10px]">
              {sources.map((source) => {
                const tier = TIER_META[source.tier ?? 'unknown'];

                return (
                  <li
                    key={source.id}
                    className="flex items-start gap-[16px] rounded-[16px] border-[3px] border-ink/15 bg-paper px-[22px] py-[10px]"
                  >
                    <span
                      className={`mt-[5px] shrink-0 rounded-md border-[3px] px-[10px] py-[1px] text-[22px] font-black tracking-wide ${tier.bg} ${tier.text} ${tier.border}`}
                    >
                      {tier.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[36px] leading-[1.2] font-black text-ink">
                        {sourceSiteLabel(source)}
                      </p>
                      <p
                        className="mt-[3px] truncate text-[36px] leading-[1.25] text-ink/70"
                        title={sourceTitleLabel(source)}
                      >
                        {sourceTitleLabel(source)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-[12px] shrink-0 text-[32px] font-bold text-muted">暂无可展示的出处</p>
          )}
        </section>

        <footer className="mt-[14px] shrink-0 border-t-[3px] border-ink/15 pt-[14px]">
          <div className="flex items-end justify-between gap-[24px]">
            <div>
              <p className="text-[32px] leading-[1.15] font-black text-ink">把结论的来路查清楚</p>
              <p className="mt-[4px] text-[23px] font-bold tracking-[0.05em] text-muted">
                AI 侦探社 · 每个结论都带出处
              </p>
            </div>
            <div className="text-right">
              <p className="text-[22px] font-bold text-muted">生成时间</p>
              <p className="mt-[2px] text-[26px] font-black tabular-nums text-ink">
                {formatGeneratedAt(generatedAt)}
              </p>
            </div>
          </div>
        </footer>
      </div>
    </article>
  );
}

export type ShareCardDialogProps = {
  open: boolean;
  /** 未结案时为 null，不渲染弹窗。 */
  verdict: Verdict | null;
  sourcesById: Record<string, Source>;
  sourceOrder: string[];
  onClose: () => void;
};

/** 分享卡弹窗：等比缩小预览，并提供下载与复制图片。 */
export function ShareCardDialog({
  open,
  verdict,
  sourcesById,
  sourceOrder,
  onClose,
}: ShareCardDialogProps) {
  return (
    <AnimatePresence>
      {open && verdict ? (
        <ShareCardModal
          key="share-card-modal"
          verdict={verdict}
          sourcesById={sourcesById}
          sourceOrder={sourceOrder}
          onClose={onClose}
        />
      ) : null}
    </AnimatePresence>
  );
}

type ShareCardModalProps = Omit<ShareCardDialogProps, 'open' | 'verdict'> & {
  verdict: Verdict;
};

function ShareCardModal({ verdict, sourcesById, sourceOrder, onClose }: ShareCardModalProps) {
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const feedbackTimer = useRef<number | null>(null);
  const [scale, setScale] = useState(0.42);
  const [busy, setBusy] = useState<'download' | 'copy' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const generatedAt = useMemo(() => new Date(), []);
  const sources = useMemo(
    () => pickAuthoritativeSources(verdict, sourcesById, sourceOrder),
    [sourceOrder, sourcesById, verdict],
  );

  /** 失败提示常驻到下一次操作，避免用户错过「改用下载」的指引。 */
  const notify = useCallback((message: string, persistent = false) => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    setFeedback(message);

    if (persistent) {
      feedbackTimer.current = null;
      return;
    }

    feedbackTimer.current = window.setTimeout(() => {
      feedbackTimer.current = null;
      setFeedback(null);
    }, FEEDBACK_MS);
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // 预览按视口等比缩小，让整张 1080×1440 卡片完整落在弹窗里。
  useEffect(() => {
    const update = () => {
      const maxWidth = Math.min(window.innerWidth * 0.88, 560);
      const maxHeight = Math.max(320, window.innerHeight - 300);
      setScale(Math.min(1, maxWidth / CARD_WIDTH, maxHeight / CARD_HEIGHT));
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
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

  /** 导出前等字体全部就绪，避免 PNG 里出现回退字体。 */
  const renderPng = useCallback(async (): Promise<string> => {
    const node = cardRef.current;
    if (!node) throw new Error('卡片尚未就绪');

    if (document.fonts) await document.fonts.ready;
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });

    return toPng(node, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      pixelRatio: PIXEL_RATIO,
    });
  }, []);

  const handleDownload = async () => {
    if (busy) return;
    setBusy('download');

    try {
      const dataUrl = await renderPng();
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = buildFileName(verdict.headline);
      document.body.appendChild(link);
      link.click();
      link.remove();
      notify('已开始下载');
    } catch {
      notify('导出失败，请重试', true);
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (busy) return;
    setBusy('copy');

    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('当前浏览器不支持复制图片');
      }

      const dataUrl = await renderPng();
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notify('图片已复制到剪贴板');
    } catch {
      notify('复制失败，请改用下载', true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.2 }}
    >
      <motion.button
        type="button"
        tabIndex={-1}
        aria-label="关闭辟谣卡片"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-scrim"
      />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-card-title"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
        transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 300, damping: 26 }}
        className="relative z-10 flex max-h-[92vh] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[24px] border-[3px] border-ink bg-card shadow-ink-lg"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-ink/15 px-5 py-3">
          <h2 id="share-card-title" className="flex items-center gap-2 text-lg font-black">
            <span aria-hidden>📤</span>
            辟谣卡片
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
          <div
            className="mx-auto shadow-ink-lg"
            style={{ width: CARD_WIDTH * scale, height: CARD_HEIGHT * scale }}
          >
            <div className="origin-top-left" style={{ transform: `scale(${scale})` }}>
              <div ref={cardRef} style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}>
                <ShareCard verdict={verdict} sources={sources} generatedAt={generatedAt} />
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] font-bold text-muted">
            1080 × 1440 · 适合手机转发 · 导出为 2 倍高清 PNG
          </p>
        </div>

        <footer className="shrink-0 border-t-2 border-ink/15 px-5 py-3">
          <div className="grid grid-cols-2 gap-2">
            <ComicButton
              variant="brand"
              size="sm"
              onClick={() => void handleDownload()}
              disabled={busy !== null}
              className="w-full"
            >
              {busy === 'download' ? '正在导出…' : '⬇️ 下载图片'}
            </ComicButton>

            <ComicButton
              variant="white"
              size="sm"
              onClick={() => void handleCopy()}
              disabled={busy !== null}
              className="w-full"
            >
              {busy === 'copy' ? '正在导出…' : '📋 复制图片'}
            </ComicButton>
          </div>
          <p
            role="status"
            className="mt-2 min-h-[16px] text-center text-[11px] font-bold text-muted"
          >
            {feedback ?? '导出前会自动等待字体加载完成'}
          </p>
        </footer>
      </motion.section>
    </motion.div>
  );
}

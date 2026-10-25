'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { ComicButton } from '@/components/ui/comic-button';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { SpeechBubble } from '@/components/ui/speech-bubble';
import { RISK_META } from '@/lib/labels';

export type ClaimsProgressProps = {
  /** 用户提交的原文；等待期间只展示原文与字数。 */
  text: string;
  elapsedSeconds: number;
  /** 取消预检并回到编辑页，文案会保留。 */
  onCancel: () => void;
};

const FLOW_STEPS = [
  { index: '①', title: '读取文案', note: '整段通读，不做改写' },
  { index: '②', title: '拆成句子', note: '按标点与语气切分' },
  { index: '③', title: '找可查证的事实 + 判断风险', note: '返回后展示真实数量' },
  { index: '④', title: '合规敏感词复核', note: '英烈 · 党史 · 民族宗教' },
  { index: '⑤', title: '生成疑点清单', note: '只生成清单，不调用搜索' },
] as const;

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/**
 * ⑥ 文案体检 · 免费预检等待页。
 * extract-claims 是一次性 JSON 请求，所以这里只做诚实的等待动效，
 * 不模拟逐句进度、真实百分比或风险数量。
 */
export function ClaimsProgress({ text, elapsedSeconds, onCancel }: ClaimsProgressProps) {
  const reduced = useReducedMotion();
  const charCount = text.length;

  return (
    <>
      <div className="mx-auto grid w-full max-w-[1440px] gap-3 px-3 py-3 pb-36 lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,1fr)] lg:pb-28">
        <section
          aria-label="待体检的原文"
          className="comic-card flex min-h-[520px] flex-col overflow-hidden"
        >
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b-2 border-ink/15 px-4 py-3">
            <h1 className="flex items-center gap-1.5 text-base font-black text-ink">
              <span aria-hidden>📄</span>
              你的文案
            </h1>
            <span className="rounded-full border-2 border-ink bg-brand-soft px-2.5 py-0.5 text-xs font-black text-brand-dark">
              {charCount} 字
            </span>
            <span
              className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-muted"
              aria-live="polite"
            >
              <span
                className={`inline-block h-2 w-2 rounded-full bg-brand ${reduced ? '' : 'animate-pulse'}`}
              />
              AI 正在分析整篇文案
            </span>
            <span className="text-[11px] font-bold text-muted">
              已等待 {formatElapsed(elapsedSeconds)}
            </span>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="relative overflow-hidden rounded-xl border-2 border-ink/20 bg-card p-4">
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 h-20"
                style={{
                  backgroundImage:
                    'linear-gradient(to bottom, transparent, var(--color-brand-soft), transparent)',
                }}
                initial={{ top: '-15%' }}
                animate={reduced ? undefined : { top: ['-15%', '88%', '-15%'] }}
                transition={{ duration: 4.8, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
              />
              <p className="relative text-[15px] leading-8 break-words whitespace-pre-wrap text-ink">
                {text}
              </p>
            </div>

            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 font-bold text-muted">
              <span aria-hidden>ℹ️</span>
              扫描线只是等待动效，不代表后端逐句处理进度；分析完成后会直接展示真实疑点。
            </p>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t-2 border-ink/15 px-4 py-2.5 text-[11px] font-bold text-muted">
            <span>虚线框 = AI 初判 · 待查证（不是结论）</span>
            <span className="ml-auto flex items-center gap-1" aria-hidden>
              {(['high', 'medium', 'low'] as const).map((risk) => (
                <i
                  key={risk}
                  className={`h-3 w-3 rounded-full border-2 border-dashed ${RISK_META[risk].border}`}
                />
              ))}
            </span>
          </footer>
        </section>

        <section
          aria-label="侦探分析流程"
          className="comic-card flex min-h-[520px] flex-col overflow-hidden"
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b-2 border-ink/15 px-4 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-ink bg-brand-soft">
              <DetectiveMascot variant="avatar" className="h-11 w-11 -translate-y-1" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base leading-snug font-black text-ink">侦探正在找疑点…</h2>
              <p className="text-[11px] font-bold text-muted">正在分析，通常需要一些时间</p>
            </div>
            <span
              className={`ml-auto rounded-full border-2 border-ink bg-beige px-2.5 py-0.5 text-[11px] font-black whitespace-nowrap text-ink ${reduced ? '' : 'animate-pulse'}`}
            >
              分析中
            </span>
          </header>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            <p className="rounded-lg border border-dashed border-ink/25 bg-paper px-2.5 py-1.5 text-[11px] leading-4 font-bold text-muted">
              下面只是流程说明。接口一次性返回结果，等待期间不会伪造「已完成第几步」。
            </p>

            <ol className="space-y-2">
              {FLOW_STEPS.map((step, index) => (
                <li
                  key={step.index}
                  aria-current={index === 2 ? 'step' : undefined}
                  className={`flex items-start gap-2.5 rounded-xl border-2 border-dashed px-3 py-2.5 ${
                    index === 2 ? 'border-brand bg-brand-soft/50' : 'border-ink/20 bg-card'
                  }`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-card text-xs font-black text-ink">
                    {step.index}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm leading-5 font-black text-ink">{step.title}</p>
                    <p className="text-[11px] leading-4 font-bold text-muted">{step.note}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex items-start gap-2 pt-1">
              <DetectiveMascot variant="avatar" className="w-9 shrink-0 -rotate-3" />
              <SpeechBubble tail="left" className="text-xs leading-5">
                正在通读整篇文案，找出人名、时间、数字和绝对化说法；有结果后会先给你看风险分布，再让你决定查哪些。
              </SpeechBubble>
            </div>

            <p className="rounded-lg border-2 border-dashed border-ink/20 bg-paper px-2.5 py-2 text-[11px] leading-4 font-bold text-muted">
              现在还没有疑点数量可以展示；分析失败会给出明确原因和重试入口，不会先扣积分。
            </p>
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-ink bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-2 px-4 py-3">
          <span className="flex items-center gap-1.5 rounded-full border-2 border-brand bg-brand-soft px-3 py-1 text-xs font-black text-brand-dark">
            🎁 免费 · 不调用元宝搜索 · 不扣积分
          </span>
          <span className="text-[11px] font-bold text-muted">预检完成后再决定查哪些</span>
          <ComicButton variant="white" size="sm" onClick={onCancel} className="ml-auto">
            取消，返回编辑
          </ComicButton>
        </div>
      </div>
    </>
  );
}

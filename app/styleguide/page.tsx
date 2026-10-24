import { ArrowRight, Search, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Tier, VerdictLevel } from '@/types/case';
import { Badge } from '@/components/ui/badge';
import { Burst, type BurstTone } from '@/components/ui/burst';
import { ComicButton } from '@/components/ui/comic-button';
import { ComicCard } from '@/components/ui/comic-card';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { SpeechBubble } from '@/components/ui/speech-bubble';
import { Sticker, type StickerTone } from '@/components/ui/sticker';
import { Typewriter } from '@/components/ui/typewriter';
import { VerdictBadge } from '@/components/ui/verdict-badge';

const PALETTE = [
  { name: 'brand', hex: '#00B259', className: 'bg-brand' },
  { name: 'brand-dark', hex: '#00813F', className: 'bg-brand-dark' },
  { name: 'brand-soft', hex: '#E6F7EE', className: 'bg-brand-soft' },
  { name: 'orange', hex: '#E37318', className: 'bg-orange' },
  { name: 'red', hex: '#D54941', className: 'bg-red' },
  { name: 'blue', hex: '#366EF4', className: 'bg-blue' },
  { name: 'gray', hex: '#8A8F98', className: 'bg-gray' },
  { name: 'ink', hex: '#1F2329', className: 'bg-ink' },
  { name: 'bg', hex: '#F2FBF6', className: 'bg-bg' },
] as const;

const TIERS: Tier[] = ['official', 'media', 'self', 'marketing', 'unknown'];
const VERDICTS: VerdictLevel[] = [
  'true',
  'partly_true',
  'out_of_context',
  'unverified',
  'false',
];

const BURSTS: { label: string; tone: BurstTone }[] = [
  { label: '属实', tone: 'brand' },
  { label: '部分属实', tone: 'orange' },
  { label: '断章取义', tone: 'orange' },
  { label: '无法证实', tone: 'gray' },
  { label: '谣言', tone: 'red' },
];

const STICKERS: { label: string; tone: StickerTone; rotate: number }[] = [
  { label: '报案单', tone: 'red', rotate: 6 },
  { label: '新！', tone: 'brand', rotate: -5 },
  { label: '开发中', tone: 'orange', rotate: 4 },
  { label: '官方', tone: 'blue', rotate: -3 },
  { label: '暂无出处', tone: 'gray', rotate: 7 },
  { label: '手写也行', tone: 'white', rotate: -6 },
];

function SectionHeading({
  index,
  title,
  hint,
}: {
  index: string;
  title: string;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Sticker tone="brand" rotate={-3}>
        {index}
      </Sticker>
      <h2 className="text-xl font-black tracking-wide sm:text-2xl">{title}</h2>
      {hint ? <p className="text-xs font-medium text-gray">{hint}</p> : null}
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <main className="paper-bg min-h-dvh px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-5xl space-y-10">
        <header className="relative text-center">
          <div className="mb-3 flex justify-center gap-2">
            <Sticker tone="brand" rotate={-4}>
              元宝配色
            </Sticker>
            <Sticker tone="orange" rotate={3}>
              综艺动漫风
            </Sticker>
          </div>
          <h1 className="huazi -rotate-2 text-[clamp(38px,7vw,68px)]">视觉部品大集合!</h1>
          <p className="mt-4 text-sm font-bold text-gray">
            设计 token、基础组件与五档判决样式，全部在这一页验收。
          </p>
        </header>

        <section>
          <SectionHeading index="01" title="配色 token" hint="来源等级与判决色共用一套色板" />
          <ComicCard className="p-4 sm:p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {PALETTE.map((color) => (
                <div key={color.name} className="rounded-lg border-2 border-ink bg-card p-2">
                  <div className={`h-14 rounded-md border-2 border-ink ${color.className}`} />
                  <p className="mt-2 text-xs font-black">{color.name}</p>
                  <p className="font-mono text-[10px] text-gray">{color.hex}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border-2 border-ink bg-brand-soft p-3">
                <p className="text-xs font-black text-brand-dark">来源分级</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {TIERS.map((tier) => (
                    <Badge key={tier} tier={tier} />
                  ))}
                </div>
              </div>
              <div className="rounded-lg border-2 border-ink bg-gray-soft p-3">
                <p className="text-xs font-black">五档判决</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {VERDICTS.map((level) => (
                    <VerdictBadge key={level} level={level} size="sm" />
                  ))}
                </div>
              </div>
            </div>
          </ComicCard>
        </section>

        <section>
          <SectionHeading index="02" title="字体：400 / 700 / 900" hint="Noto Sans SC，900 用于花字与按钮" />
          <ComicCard className="space-y-4 p-5 sm:p-6">
            <div>
              <p className="text-[11px] font-black tracking-widest text-gray">900 · 花字标题</p>
              <p className="huazi mt-1 text-4xl">把结论的来路查清楚！</p>
            </div>
            <div>
              <p className="text-[11px] font-black tracking-widest text-gray">700 · 小标题 / 按钮</p>
              <p className="mt-1 text-2xl font-bold">疑点拆解 · 正反搜证 · 五档判决</p>
            </div>
            <div>
              <p className="text-[11px] font-black tracking-widest text-gray">400 · 正文</p>
              <p className="mt-1 text-base leading-8">
                喝咖啡会致癌？先别急着转发。系统会拆出可疑说法，分别搜正反证据，再把同源转载合并成一条时间线。
              </p>
            </div>
          </ComicCard>
        </section>

        <section>
          <SectionHeading index="03" title="ComicButton" hint="按下时整体位移 3px，硬投影消失" />
          <ComicCard className="flex flex-wrap items-center gap-3 p-5 sm:p-6">
            <ComicButton>
              <Search className="h-4 w-4" />
              立案调查！
            </ComicButton>
            <ComicButton variant="orange" size="md">
              重新搜证
            </ComicButton>
            <ComicButton variant="red" size="md">
              判为谣言
            </ComicButton>
            <ComicButton variant="white" size="sm">
              复制出处
            </ComicButton>
            <ComicButton variant="ink" size="lg">
              打开完整卷宗
              <ArrowRight className="h-4 w-4" />
            </ComicButton>
            <ComicButton variant="brand" size="sm" disabled>
              生成中…
            </ComicButton>
          </ComicCard>
        </section>

        <section>
          <SectionHeading index="04" title="ComicCard · 三种底色" hint="白 / 薄荷绿 / 墨黑" />
          <div className="grid gap-4 sm:grid-cols-3">
            <ComicCard className="p-4">
              <Sticker tone="white" rotate={-3}>
                白底
              </Sticker>
              <h3 className="mt-3 text-lg font-black">来源卡片</h3>
              <p className="mt-1 text-xs leading-6 text-gray">
                默认信息卡：白底 + 3px 黑描边 + 黑色硬投影。
              </p>
            </ComicCard>
            <ComicCard tone="mint" className="p-4">
              <Sticker tone="brand" rotate={3}>
                薄荷绿
              </Sticker>
              <h3 className="mt-3 text-lg font-black">已确认</h3>
              <p className="mt-1 text-xs leading-6 text-ink/70">
                绿色硬投影，用于当前阶段、官方来源与正向结论。
              </p>
            </ComicCard>
            <ComicCard tone="ink" className="p-4">
              <Sticker tone="orange" rotate={-4}>
                墨黑
              </Sticker>
              <h3 className="mt-3 text-lg font-black">结案播报</h3>
              <p className="mt-1 text-xs leading-6 text-white/70">深色底用于强调终局结论与播报条。</p>
            </ComicCard>
          </div>
        </section>

        <section>
          <SectionHeading index="05" title="Sticker · 歪贴标签" hint="旋转角度可调" />
          <ComicCard className="flex flex-wrap items-center gap-3 p-5 sm:p-6">
            {STICKERS.map((sticker) => (
              <Sticker key={sticker.label} tone={sticker.tone} rotate={sticker.rotate}>
                {sticker.label}
              </Sticker>
            ))}
          </ComicCard>
        </section>

        <section>
          <SectionHeading index="06" title="SpeechBubble · 对白气泡" hint="尾巴支持左 / 右 / 下" />
          <ComicCard className="space-y-8 p-5 sm:p-6">
            <div className="flex flex-wrap items-start gap-10">
              <SpeechBubble tail="bottom">这条消息靠谱吗？！</SpeechBubble>
              <SpeechBubble tone="brand" tail="bottom">
                把结论的来路查清楚！
              </SpeechBubble>
              <SpeechBubble tone="ink" tail="none">
                卷宗已归档，可回看任意一幕。
              </SpeechBubble>
            </div>
            <div className="flex flex-wrap items-center gap-10">
              <SpeechBubble tail="left">左边有话说</SpeechBubble>
              <SpeechBubble tail="right">右边有补充</SpeechBubble>
            </div>
          </ComicCard>
        </section>

        <section>
          <SectionHeading index="07" title="DetectiveMascot" hint="SVG 吉祥物，可随尺寸缩放" />
          <ComicCard className="flex flex-wrap items-center gap-6 p-5 sm:p-6">
            <DetectiveMascot className="w-28 shrink-0 -rotate-3" />
            <SpeechBubble tone="brand" tail="left">
              别急着转发，先让我看看出处！
            </SpeechBubble>
          </ComicCard>
        </section>

        <section>
          <SectionHeading index="08" title="Badge · 来源等级" hint="官方 / 媒体 / 自媒体 / 营销号 / 未知" />
          <ComicCard className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              {TIERS.map((tier) => (
                <Badge key={tier} tier={tier} />
              ))}
            </div>
            <div className="mt-5 border-t-2 border-dashed border-ink/20 pt-4">
              <p className="mb-2 text-[11px] font-black tracking-widest text-gray">无圆点版本</p>
              <div className="flex flex-wrap items-center gap-2">
                {TIERS.map((tier) => (
                  <Badge key={tier} tier={tier} showDot={false} />
                ))}
              </div>
            </div>
          </ComicCard>
        </section>

        <section>
          <SectionHeading index="09" title="VerdictBadge · 五档判决" hint="属实 / 部分属实 / 断章取义 / 无法证实 / 谣言" />
          <ComicCard className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              {VERDICTS.map((level) => (
                <VerdictBadge key={level} level={level} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {VERDICTS.map((level) => (
                <VerdictBadge key={level} level={level} size="sm" />
              ))}
            </div>
          </ComicCard>
        </section>

        <section>
          <SectionHeading index="10" title="Burst · 爆炸形印章" hint="盖章入场，尊重减少动态偏好" />
          <ComicCard className="flex flex-wrap items-center justify-around gap-6 p-5 py-8 sm:p-8">
            {BURSTS.map((burst) => (
              <Burst key={burst.label} label={burst.label} tone={burst.tone} size="md" />
            ))}
          </ComicCard>
        </section>

        <section>
          <SectionHeading index="11" title="Typewriter · 逐字打出" hint="减少动态偏好下直接全文显示" />
          <ComicCard tone="ink" className="p-5 sm:p-6">
            <p className="text-[11px] font-black tracking-widest text-white/60">办案播报</p>
            <p className="mt-2 text-lg leading-9 font-bold sm:text-xl">
              <Sparkles className="mr-2 inline h-5 w-5 text-brand" aria-hidden />
              <Typewriter text="疑点已拆成 3 条。正在为每条分别搜索正反证据，同源转载会自动合并。" />
            </p>
          </ComicCard>
        </section>

        <footer className="pb-4 text-center text-xs font-medium text-gray">
          新增组件或色板时，先改这里验收，再落到页面。
        </footer>
      </div>
    </main>
  );
}

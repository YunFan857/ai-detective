import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { LeafMark } from '@/components/ui/icons';

export function HomeHero() {
  return (
    <section className="relative mx-auto w-full max-w-[900px] px-4 pt-8 sm:pt-10">
      <h1 className="ink-title -rotate-2 text-center text-[clamp(44px,7.4vw,76px)] leading-none font-black tracking-[0.06em]">
        AI 侦探社!
      </h1>

      <div className="relative mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-3 sm:mt-3">
        <DetectiveMascot className="pointer-events-none absolute -top-5 left-0 z-10 w-[78px] -rotate-3 sm:-top-4 sm:left-1 sm:w-[100px]" />

        <span className="ml-[72px] -rotate-2 rounded-xl border-2 border-ink bg-card px-3.5 py-1.5 text-sm font-bold shadow-ink-sm sm:ml-[104px]">
          这条消息靠谱吗？！
        </span>
        <span className="rotate-1 rounded-xl border-2 border-ink bg-brand px-4 py-1.5 text-base font-black text-white shadow-ink-sm [text-shadow:1.5px_1.5px_0_var(--color-ink)]">
          把结论的来路查清楚！
        </span>
      </div>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted">
        Powered by
        <LeafMark className="h-3.5 w-3.5" />
        <span className="text-ink">元宝搜索</span>
      </p>
    </section>
  );
}

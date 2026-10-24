import { FolderIcon } from '@/components/ui/icons';

export function HomeHero() {
  return (
    <section className="relative mx-auto w-full max-w-[900px] px-4 pt-8 sm:pt-10">
      <div className="mb-6 flex justify-end">
        <a
          href="#history-cases"
          className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-card px-3.5 py-1.5 text-sm font-black shadow-ink-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-dark"
        >
          <FolderIcon className="h-4 w-4 text-tangerine" />
          历史案件
        </a>
      </div>

      <h1 className="ink-title -rotate-2 text-center text-[clamp(44px,7.4vw,76px)] leading-none font-black tracking-[0.06em]">
        AI 侦探社!
      </h1>

      <div className="mt-5 flex justify-center sm:mt-3">
        <span className="rotate-1 rounded-xl border-2 border-ink bg-brand px-4 py-1.5 text-base font-black text-white shadow-ink-sm [text-shadow:1.5px_1.5px_0_var(--color-ink)]">
          把结论的来路查清楚
        </span>
      </div>
    </section>
  );
}

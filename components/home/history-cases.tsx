import Link from 'next/link';
import { FolderIcon } from '@/components/ui/icons';

type VerdictTone = 'out_of_context' | 'false' | 'true';

const TONE: Record<VerdictTone, { label: string; className: string }> = {
  out_of_context: { label: '断章取义', className: 'bg-tangerine' },
  false: { label: '谣言！', className: 'bg-coral' },
  true: { label: '真实 ✓', className: 'bg-brand' },
};

const DEMO_CASES: { title: string; quote: string; tone: VerdictTone }[] = [
  { title: '咖啡致癌？', quote: '“世卫专家证实喝咖啡会致癌”', tone: 'out_of_context' },
  { title: '自来水管含毒', quote: '“紧急通知！今晚的水别喝…”', tone: 'false' },
  { title: '秦陵水银', quote: '“秦始皇陵里有大量水银”', tone: 'true' },
];

export function HistoryCases() {
  return (
    <section className="mx-auto mt-7 w-full max-w-[860px] px-4">
      <h2 className="flex items-center gap-2 text-sm font-black">
        <FolderIcon className="h-4 w-4 text-tangerine" />
        历史卷宗
        <span className="text-muted">｜</span>
        <span className="font-bold text-muted">点开看名场面</span>
      </h2>

      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {DEMO_CASES.map((item) => {
          const tone = TONE[item.tone];
          return (
            <li key={item.title} className="relative">
              <Link
                href="/case"
                className="relative block rounded-xl border-2 border-ink bg-beige px-4 pt-4 pb-3 shadow-ink-sm transition-transform hover:-translate-y-0.5 hover:shadow-ink"
              >
                <span
                  className={`absolute -top-2.5 right-3 rotate-3 rounded border-2 border-ink px-2 py-0.5 text-[10px] font-black text-white ${tone.className}`}
                >
                  {tone.label}
                </span>
                <p className="text-sm font-black">{item.title}</p>
                <p className="mt-1 truncate text-[11px] text-muted">{item.quote}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

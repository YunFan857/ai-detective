import Link from 'next/link';
import { FolderIcon } from '@/components/ui/icons';
import { VERDICT_META, verdictLabel } from '@/lib/labels';
import type { VerdictLevel } from '@/types/case';

type DemoCase = {
  id: string;
  title: string;
  input: string;
  verdict: VerdictLevel;
};

/**
 * 演示卷宗先硬编码；后端提交 cache/index.json（[{ id, title, input }]）后改为读取。
 * 结论印章需另配，后端就绪前先用本地硬编码的 verdict。
 */
const DEMO_CASES: DemoCase[] = [
  {
    id: 'demo-1',
    title: '香蕉有辐射？',
    input: '“香蕉含有放射性物质，吃香蕉会摄入微量辐射”',
    verdict: 'true',
  },
  {
    id: 'demo-2',
    title: '咖啡致癌？',
    input: '“喝咖啡会致癌，世卫组织专家已证实”',
    verdict: 'out_of_context',
  },
  {
    id: 'demo-3',
    title: '小龙虾是尸食？',
    input: '“小龙虾是日本人用来处理尸体的，千万别吃”',
    verdict: 'false',
  },
];

export function HistoryCases() {
  return (
    <section id="history-cases" className="mx-auto mt-7 w-full max-w-[860px] scroll-mt-6 px-4">
      <h2 className="flex items-center gap-2 text-sm font-black">
        <FolderIcon className="h-4 w-4 text-tangerine" />
        历史卷宗
        <span className="text-muted">｜</span>
        <span className="font-bold text-muted">点开看名场面</span>
      </h2>

      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {DEMO_CASES.map((item) => (
          <li key={item.id} className="relative">
            <Link
              href={`/case?mode=demo&demoId=${encodeURIComponent(item.id)}`}
              className="relative block rounded-xl border-2 border-ink bg-beige px-4 pt-4 pb-3 shadow-ink-sm transition-transform hover:-translate-y-0.5 hover:shadow-ink"
            >
              <span
                className={`absolute -top-2.5 right-3 rotate-3 rounded border-2 border-ink px-2 py-0.5 text-[10px] font-black text-white shadow-ink-sm ${VERDICT_META[item.verdict].solid}`}
              >
                {verdictLabel(item.verdict)}
              </span>
              <p className="text-sm font-black">{item.title}</p>
              <p className="mt-1 truncate text-[11px] text-muted">{item.input}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

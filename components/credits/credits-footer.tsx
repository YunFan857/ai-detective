import Link from 'next/link';
import { Info, PlayCircle } from 'lucide-react';

/** 积分中心页脚：服务对象、使用方式与开始体检入口。 */
export function CreditsFooter() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-3 pb-8">
      <div className="rounded-2xl border-[3px] border-ink bg-card px-3 py-2.5 shadow-ink-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-muted">
            <span className="rounded-full border border-ink bg-brand-soft px-2 py-0.5 font-black text-brand-dark">
              服务谁
            </span>
            历史 / 知识类带货短视频创作者
          </p>
          <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-muted">
            <span className="rounded-full border border-ink bg-orange-soft px-2 py-0.5 font-black text-orange">
              怎么用
            </span>
            贴文案 → 免费找疑点 → 勾选查证
          </p>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <p className="flex items-center gap-1 text-[10px] font-bold text-muted">
              <Info className="h-3.5 w-3.5" aria-hidden />
              演示积分 · 仅保存在当前浏览器 · 不支持真实支付
            </p>
            <Link
              href="/?intake=scriptcheck"
              className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-ink bg-brand px-4 py-1.5 text-sm font-black text-white shadow-ink-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
            >
              <PlayCircle className="h-4 w-4" aria-hidden />
              开始体检
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

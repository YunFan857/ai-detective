import Link from 'next/link';
import { DetectiveMascot } from '@/components/ui/detective-mascot';

export type CaseErrorProps = {
  /** HTTP 状态码，用于区分输入问题、服务端故障等。 */
  status: number;
};

/** 把状态码翻译成不暴露内部细节的友好提示。 */
function friendlyMessage(status: number): string {
  if (status === 400) return '这条消息不符合立案要求，改一改再来试试。';
  if (status === 404) return '没找到这份卷宗，可能已经被移走了。';
  if (status === 501) return '这种立案方式还没开通，先改用文字试试。';
  if (status >= 500) return '侦探社暂时忙不过来，请稍后再试。';
  return '立案没有成功，请检查网络后再试。';
}

/** 立案接口返回 HTTP 错误时的整页提示：友好文案 + 返回首页。 */
export function CaseError({ status }: CaseErrorProps) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <section className="comic-card w-full max-w-[440px] px-8 py-10 text-center">
        <DetectiveMascot className="mx-auto w-[96px] -rotate-3" />

        <p className="mt-4 text-xs font-black tracking-wide text-muted">卷宗未能立案</p>
        <h1 className="mt-2 text-xl leading-snug font-black text-ink">{friendlyMessage(status)}</h1>
        <p className="mt-2 text-xs font-bold text-muted">错误代码：HTTP {status}</p>

        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full border-[3px] border-ink bg-brand px-6 py-2.5 text-base font-black text-white shadow-ink transition-transform hover:-translate-y-0.5 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
        >
          🏠 返回首页
        </Link>
      </section>
    </div>
  );
}

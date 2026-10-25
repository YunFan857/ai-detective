import type { Metadata } from 'next';
import { CreditsWorkspace } from '@/components/credits/credits-workspace';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata: Metadata = {
  title: '积分中心 · AI 侦探社',
  description: '本地演示积分：签到、模拟充值、查证扣费与退款。不支持真实支付。',
};

/** 积分中心 ⑧：页面只做拼装，业务状态在 useCreditsCenter。 */
export default function CreditsPage() {
  return (
    <main className="min-h-dvh bg-paper text-ink">
      <ErrorBoundary label="积分中心">
        <CreditsWorkspace />
      </ErrorBoundary>
    </main>
  );
}

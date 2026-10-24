import { ClaimsWorkspace } from '@/components/claims/claims-workspace';
import { ErrorBoundary } from '@/components/ui/error-boundary';

/** 文案体检 ⑥/⑦：页面只做拼装，请求与状态机在 useClaimsCheck。 */
export default function ClaimsPage() {
  return (
    <main className="min-h-dvh bg-paper text-ink">
      <ErrorBoundary label="文案体检">
        <ClaimsWorkspace />
      </ErrorBoundary>
    </main>
  );
}

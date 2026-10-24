'use client';

import { useRouter } from 'next/navigation';
import { ClaimsPick } from '@/components/claims/claims-pick';
import { ClaimsProgress } from '@/components/claims/claims-progress';
import { ClaimsStateCard } from '@/components/claims/claims-state-card';
import { ClaimsTopBar } from '@/components/claims/claims-top-bar';
import { useClaimsCheck } from '@/lib/use-claims-check';

/** /claims 的拼装层：请求与状态机都在 useClaimsCheck 里。 */
export function ClaimsWorkspace() {
  const router = useRouter();
  const check = useClaimsCheck();
  const claims = check.preview?.claims ?? [];

  const badge =
    check.phase === 'ready'
      ? claims.length > 0
        ? `找到 ${claims.length} 个疑点`
        : '未发现疑点'
      : check.phase === 'error'
        ? '分析失败'
        : check.phase === 'missing'
          ? '没有待体检文案'
          : check.phase === 'reading'
            ? '读取中'
            : '找疑点';

  return (
    <div className="paper-bg min-h-dvh">
      <ClaimsTopBar badge={badge} />

      {check.phase === 'reading' ? (
        <div className="mx-auto grid w-full max-w-[1440px] place-items-center px-4 py-24" role="status">
          <p className="text-sm font-black text-muted">正在读取待体检的文案…</p>
        </div>
      ) : null}

      {check.phase === 'missing' ? (
        <ClaimsStateCard
          eyebrow="文案体检"
          title="没有找到待体检的文案"
          description="回到首页写一段 50–1500 字的文案，再点「免费找疑点」。"
          primaryLabel="回首页写文案"
          onPrimary={() => router.push('/')}
        />
      ) : null}

      {check.phase === 'loading' && check.draft ? (
        <ClaimsProgress
          text={check.draft.text}
          elapsedSeconds={check.elapsedSeconds}
          onCancel={check.backToEdit}
        />
      ) : null}

      {check.phase === 'error' && check.draft ? (
        <ClaimsStateCard
          mood="yawn"
          eyebrow="免费预检 · 未扣积分"
          title={check.failure?.title ?? '预检没有成功'}
          description={check.failure?.message ?? '请稍后重试，文案已保留。'}
          detail={check.failure?.detail}
          primaryLabel="重新分析"
          onPrimary={check.retry}
          secondaryLabel="返回编辑"
          onSecondary={check.backToEdit}
        />
      ) : null}

      {check.phase === 'ready' && check.preview && claims.length === 0 ? (
        <ClaimsStateCard
          mood="yawn"
          eyebrow="体检完成 · 0 个疑点"
          title="未发现需要查证的事实，不扣积分"
          description="这段文案里没有足以检索核对的具体事实。可以返回补充人名、时间、数字或因果说法，或换一段文案。"
          primaryLabel="返回编辑"
          onPrimary={check.backToEdit}
          secondaryLabel="去首页"
          onSecondary={() => router.push('/')}
        />
      ) : null}

      {check.phase === 'ready' && check.preview && claims.length > 0 ? (
        <ClaimsPick
          preview={check.preview}
          selectedIds={check.selectedIds}
          notice={check.notice}
          confirming={check.confirming}
          atLimit={check.atLimit}
          onToggle={check.toggle}
          onToggleMany={check.toggleMany}
          onSelectHigh={check.selectHigh}
          onSelectAll={check.selectAll}
          onClear={check.clear}
          onConfirm={check.confirm}
          onBackEdit={check.backToEdit}
        />
      ) : null}
    </div>
  );
}

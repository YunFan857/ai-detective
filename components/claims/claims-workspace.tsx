'use client';

import { useRouter } from 'next/navigation';
import { ClaimsAutorun } from '@/components/claims/claims-autorun';
import { ClaimsPick } from '@/components/claims/claims-pick';
import { ClaimsProgress } from '@/components/claims/claims-progress';
import { ClaimsStateCard } from '@/components/claims/claims-state-card';
import { ClaimsTopBar } from '@/components/claims/claims-top-bar';
import { useClaimsAutorun } from '@/lib/use-claims-autorun';
import { useClaimsCheck } from '@/lib/use-claims-check';

/**
 * Cache Components 会保留页面状态，二次提交新文案时旧草稿与旧预览不会重置。
 * 用 bfcacheId 作 key：push / replace 新导航时重挂载并重新读取草稿，浏览器前进后退仍保留现场。
 */
export function ClaimsWorkspace() {
  const { bfcacheId } = useRouter();
  return <ClaimsWorkspaceContent key={bfcacheId} />;
}

/** /claims 的拼装层：请求与状态机都在 useClaimsCheck / useClaimsAutorun 里。 */
function ClaimsWorkspaceContent() {
  const router = useRouter();
  const check = useClaimsCheck();
  const autorun = useClaimsAutorun(check);
  const claims = check.preview?.claims ?? [];
  const route = check.phase === 'ready' ? autorun.route : null;

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

      {check.phase === 'ready' && check.preview && route === 'empty' ? (
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

      {check.phase === 'ready' && check.preview && route === 'autorun' ? (
        <ClaimsAutorun ctl={autorun} onBackEdit={check.backToEdit} />
      ) : null}

      {check.phase === 'ready' && check.preview && route === 'pick' ? (
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
          manualNote={
            autorun.pickReason === 'mismatch'
              ? '本次疑点较少，但自动开查条件未满足，已回退为手动确认，不会自动开查或自动扣费。'
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

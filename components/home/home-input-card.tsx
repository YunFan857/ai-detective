'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
import { FACTCHECK_RESERVE_CLAIMS, FACTCHECK_RESERVE_POINTS } from '@/lib/credits-policy';
import { releaseCredits, reserveCredits } from '@/lib/credits-store';
import { writeCreditsIntake } from '@/lib/credits-intake';
import {
  CLAIMS_CHECK_HOME,
  SCRIPTCHECK_MAX,
  SCRIPTCHECK_MIN,
  readClaimsDraft,
  writeClaimsDraft,
} from '@/lib/claims-intake';
import { SpeechBubble } from '@/components/ui/speech-bubble';
import {
  resetCaseSession,
  terminateActiveCase,
  useActiveCase,
} from '@/lib/use-investigation';
import {
  CameraIcon,
  LinkIcon,
  MicIcon,
  PencilIcon,
  PictureIcon,
  ScribbleIcon,
  VideoIcon,
} from '@/components/ui/icons';

type Mode = 'text' | 'link' | 'image' | 'video';
type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const MODES: { id: Mode; label: string; Icon: Icon; badge?: string }[] = [
  { id: 'text', label: '文字', Icon: PencilIcon },
  { id: 'link', label: '链接', Icon: LinkIcon },
  { id: 'image', label: '图片', Icon: PictureIcon },
  { id: 'video', label: '视频', Icon: VideoIcon, badge: '开发中' },
];

const TEXT_LIMIT = 500;
const TEXT_MIN = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 压缩后最长边与目标体积：保证会话存储放得下，也够识别截图文字。 */
const MAX_IMAGE_EDGE = 1600;
const TARGET_IMAGE_BYTES = 1024 * 1024;
const IMAGE_STORAGE_KEY = 'intake-image';

const HOME_NOTICES: Record<string, string> = {
  'image-expired': '图片已失效，请重新上传',
  'image-retry': '请重新上传一张更清晰的截图',
};

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** data URL 里 base64 的实际字节数，用于把压缩结果控制在会话存储上限内。 */
function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl.length;
  return Math.ceil(((dataUrl.length - comma - 1) * 3) / 4);
}

/** 截图压成 JPEG data URL：最长边 1600，体积不超过 1MB。 */
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  try {
    let scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    let dataUrl = '';

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器不支持压缩图片');

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);

      dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      for (
        let quality = 0.75;
        estimateDataUrlBytes(dataUrl) > TARGET_IMAGE_BYTES && quality >= 0.45;
        quality -= 0.1
      ) {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      if (estimateDataUrlBytes(dataUrl) <= TARGET_IMAGE_BYTES) break;
      scale *= 0.75;
    }

    return dataUrl;
  } finally {
    bitmap.close();
  }
}

export function HomeInputCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeCase = useActiveCase();
  const noticeCode = searchParams.get('notice');
  const notice = noticeCode ? HOME_NOTICES[noticeCode] : undefined;
  const intakeParam = searchParams.get('intake');
  const isMock = searchParams.get('mode') === 'mock';
  /** 业务模式与输入方式分开：文案体检先免费预检，消息查证直接立案。 */
  const [business, setBusiness] = useState<'factcheck' | 'scriptcheck'>(
    intakeParam === 'scriptcheck' ? 'scriptcheck' : 'factcheck',
  );
  const scriptcheck = business === 'scriptcheck';
  const [mode, setMode] = useState<Mode>(noticeCode ? 'image' : 'text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [locked, setLocked] = useState(false);
  const [listening, setListening] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [creditShortfall, setCreditShortfall] = useState<number | null>(null);
  const [file, setFile] = useState<{
    raw: File;
    name: string;
    size: number;
    preview: string;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [terminateConfirm, setTerminateConfirm] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 首页被路由缓存隐藏后返回时，清掉上一次跳转遗留的加载态与终止确认；
  // 正在进行的办案由顶部「正在立案」接管，不会一直卡在禁用的按钮上。
  useEffect(() => {
    return () => {
      setSubmitting(false);
      setTerminateConfirm(false);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (file?.preview) URL.revokeObjectURL(file.preview);
    };
  }, [file]);

  // 从文案体检返回编辑时回填原文；只读一次，不改动用户当前正在输入的内容。
  useEffect(() => {
    if (intakeParam !== 'scriptcheck') return;
    let cancelled = false;
    const draft = readClaimsDraft();
    queueMicrotask(() => {
      if (cancelled) return;
      setBusiness('scriptcheck');
      setMode('text');
      if (draft) setText(draft.text);
    });
    return () => {
      cancelled = true;
    };
  }, [intakeParam]);

  const acceptFile = useCallback((next: File | undefined) => {
    if (!next) return;
    if (!next.type.startsWith('image/')) {
      setFileError('只支持 jpg / png / webp 图片');
      return;
    }
    if (next.size > MAX_IMAGE_BYTES) {
      setFileError(`图片不能超过 5MB，当前 ${formatSize(next.size)}`);
      return;
    }

    setFileError(null);
    const preview = URL.createObjectURL(next);
    setFile((previous) => {
      if (previous) URL.revokeObjectURL(previous.preview);
      return { raw: next, name: next.name || '截图', size: next.size, preview };
    });
  }, []);

  // 图片模式下支持直接 ⌘V 粘贴截图，不必先点虚线框。
  useEffect(() => {
    if (mode !== 'image') return;
    const onPaste = (event: ClipboardEvent) => {
      const next = event.clipboardData?.files[0];
      if (!next) return;
      event.preventDefault();
      acceptFile(next);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptFile, mode]);

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  })();

  const trimmedText = text.trim();
  const textLimit = scriptcheck ? SCRIPTCHECK_MAX : TEXT_LIMIT;
  const textMin = scriptcheck ? SCRIPTCHECK_MIN : TEXT_MIN;
  const textTooShort = trimmedText.length > 0 && trimmedText.length < textMin;
  const textTooLong = trimmedText.length > textLimit;
  /** 文本模式的校验提示：太短或太长时按钮禁用并说明原因。 */
  const textHint = textTooLong
    ? `最多 ${textLimit} 个字，当前 ${trimmedText.length} 字`
    : textTooShort
      ? `至少 ${textMin} 个字，还差 ${textMin - trimmedText.length} 个字`
      : null;
  const canSubmit =
    (mode === 'text' && !textHint && trimmedText.length >= textMin) ||
    (!scriptcheck && mode === 'link' && host.length > 0) ||
    (!scriptcheck && mode === 'image' && file !== null);
  const visibleModes = scriptcheck ? MODES.filter((item) => item.id === 'text') : MODES;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;

    if (scriptcheck) {
      setFormError(null);
      if (!writeClaimsDraft(trimmedText)) {
        setFormError('浏览器会话存储不可用，无法进入文案体检，请检查隐私设置后重试');
        return;
      }
      router.push(CLAIMS_CHECK_HOME);
      return;
    }

    if (mode === 'image' && file) {
      setSubmitting(true);
      setFileError(null);
      try {
        const dataUrl = await compressImage(file.raw);
        sessionStorage.setItem(IMAGE_STORAGE_KEY, dataUrl);
        resetCaseSession();
        router.push('/case?mode=real&input=image');
      } catch (error) {
        setFileError(
          error instanceof DOMException
            ? '截图太大，浏览器存不下，换一张更小的截图试试'
            : '截图压缩失败，换一张 jpg / png 图片试试',
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (mode === 'text') {
      if (!isMock) {
        setSubmitting(true);
        setFormError(null);
        setCreditShortfall(null);

        // 自动模式在请求前不知道疑点数：按后端单案上限 3 个预占，结案按 billing 退回差额。
        const reservation = reserveCredits({
          points: FACTCHECK_RESERVE_POINTS,
          flow: 'factcheck',
          note: `消息查证预占 · 自动模式最多 ${FACTCHECK_RESERVE_CLAIMS} 个疑点`,
        });
        if (!reservation.ok) {
          setFormError(
            reservation.reason === 'insufficient'
              ? `${reservation.message} 本次不会发起查证。`
              : reservation.message,
          );
          setCreditShortfall(reservation.shortfall ?? null);
          setSubmitting(false);
          return;
        }

        if (
          !writeCreditsIntake({
            transactionId: reservation.transactionId,
            input: trimmedText,
          })
        ) {
          releaseCredits(reservation.transactionId, '立案交接失败，预占积分已退回');
          setFormError('浏览器会话存储不可用，无法交接本次立案，预占积分已退回。');
          setSubmitting(false);
          return;
        }
      }

      const target = `/case?mode=${isMock ? 'mock' : 'real'}&text=${encodeURIComponent(trimmedText)}`;
      if (!isMock) resetCaseSession();
      router.push(target);
      return;
    }

    router.push(isMock ? '/case?mode=mock' : '/case');
  }

  return (
    <section className="relative mx-auto mt-20 w-full max-w-[860px] px-4 sm:mt-16">
      <div className="relative rounded-[26px] border-[3px] border-ink bg-card p-4 shadow-ink-lg sm:p-5">
        <div className="pointer-events-none absolute -top-[58px] -left-1 z-20 flex items-end sm:-top-[66px] sm:-left-4">
          <DetectiveMascot className="h-[64px] w-auto -rotate-3 sm:h-[78px]" />
          <SpeechBubble
            tail="bottom"
            className="mb-3 -rotate-2 px-3 py-1.5 text-xs whitespace-nowrap sm:text-sm"
          >
            这条消息靠谱吗？！
          </SpeechBubble>
        </div>

        <span className="absolute -top-3 right-7 rotate-6 rounded-md border-2 border-ink bg-coral px-2.5 py-0.5 text-xs font-black text-white shadow-ink-sm">
          报案单
        </span>

        {notice && !file ? (
          <p
            role="status"
            className="mb-3 flex items-center gap-2 rounded-xl border-2 border-coral bg-coral-soft px-3 py-2 text-sm font-black text-coral"
          >
            <span aria-hidden>⚠️</span>
            {notice}
          </p>
        ) : null}

        {/* 业务模式：消息查证 / 文案体检 */}
        <div className="mb-3 rounded-xl border-2 border-ink bg-beige p-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="业务模式" className="flex flex-wrap gap-1">
              <button
                type="button"
                role="tab"
                aria-selected={!scriptcheck}
                onClick={() => {
                  setBusiness('factcheck');
                  setFormError(null);
                  setCreditShortfall(null);
                }}
                className={`rounded-lg border-2 border-ink px-3 py-1 text-xs font-black transition-transform ${
                  scriptcheck
                    ? 'bg-card text-ink hover:-translate-y-0.5'
                    : 'bg-brand text-white shadow-ink-sm [text-shadow:1px_1px_0_var(--color-ink)]'
                }`}
              >
                📰 消息查证
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scriptcheck}
                onClick={() => {
                  setBusiness('scriptcheck');
                  setMode('text');
                  setFormError(null);
                  setCreditShortfall(null);
                }}
                className={`relative rounded-lg border-2 border-ink px-3 py-1 text-xs font-black transition-transform ${
                  scriptcheck
                    ? 'bg-brand text-white shadow-ink-sm [text-shadow:1px_1px_0_var(--color-ink)]'
                    : 'bg-card text-ink hover:-translate-y-0.5'
                }`}
              >
                🎬 文案体检
                <span className="absolute -top-2 -right-2 rotate-3 rounded border border-ink bg-tangerine px-1 py-px text-[9px] font-black text-white">
                  免费
                </span>
              </button>
            </div>
            <p className="ml-auto text-[10px] font-bold text-muted">
              {scriptcheck ? '50–1500 字 · 先找疑点，再决定查哪些' : '4–500 字 · 直接立案查证'}
            </p>
          </div>
        </div>

        {/* 输入方式 */}
        <div
          role="tablist"
          aria-label="输入方式"
          className="flex flex-wrap items-center gap-2 pr-16 sm:gap-2.5"
        >
          {visibleModes.map((item) => {
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                role="tab"
                aria-selected={active}
                onClick={() => setMode(item.id)}
                className={`relative flex items-center gap-1.5 rounded-lg border-2 border-ink px-3 py-1.5 text-sm font-bold transition-transform ${
                  active
                    ? '-translate-y-1 bg-brand text-white shadow-ink-sm [text-shadow:1px_1px_0_var(--color-ink)]'
                    : 'bg-card text-ink hover:-translate-y-0.5'
                }`}
              >
                <item.Icon className="h-4 w-4" />
                {item.label}
                {item.badge ? (
                  <span className="absolute -top-2.5 -right-2 rotate-3 rounded border border-ink bg-tangerine px-1 py-px text-[9px] font-black text-white">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          {mode === 'text' ? (
            <div className="relative rounded-2xl border-2 border-ink bg-card p-4">
              <textarea
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setFormError(null);
                  setCreditShortfall(null);
                }}
                rows={3}
                aria-label={scriptcheck ? '要体检的文案' : '要查证的消息'}
                placeholder={
                  scriptcheck
                    ? '把整段口播、带货文案或文章贴进来，先免费找疑点……'
                    : '把朋友圈、家族群里那条可疑消息贴进来……'
                }
                className="block w-full resize-none bg-transparent pb-8 text-[15px] leading-8 outline-none placeholder:text-muted/80"
              />
              <span
                className={`absolute bottom-3 left-4 text-xs ${
                  textHint ? 'text-coral' : 'text-muted'
                }`}
              >
                {text.length} / {textLimit}
                {textHint ? ` · ${textHint}` : ''}
              </span>

              <div className="absolute right-4 bottom-3 flex items-end gap-2">
                {listening ? (
                  <>
                    <span className="-rotate-6 text-xs font-black text-coral">在听在听！</span>
                    <span className="flex h-5 items-end gap-0.5" aria-hidden>
                      {[0, 0.15, 0.3, 0.45, 0.6].map((delay) => (
                        <i
                          key={delay}
                          className="wave-bar block h-4 w-[3px] rounded-full bg-coral"
                          style={{ animationDelay: `${delay}s` }}
                        />
                      ))}
                    </span>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setListening((value) => !value)}
                  aria-pressed={listening}
                  aria-label={listening ? '停止语音输入' : '开始语音输入'}
                  className="grid h-11 w-11 place-items-center rounded-full border-2 border-ink bg-coral text-white shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  <MicIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'link' ? (
            <div>
              <div className="flex h-11 items-center gap-2 rounded-xl border-2 border-ink bg-card px-3">
                <LinkIcon className="h-4 w-4 shrink-0 text-muted" />
                <input
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setLocked(false);
                  }}
                  aria-label="粘贴链接"
                  placeholder="https://mp.weixin.qq.com/s/..."
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted/80"
                />
              </div>

              <div className="mt-3 flex items-center gap-3 rounded-xl border-2 border-ink bg-card p-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border-2 border-ink bg-brand-soft text-brand-deep">
                  <span className="text-lg leading-none font-black tracking-[2px]">···</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {host || 'mp.weixin.qq.com'}
                    <span className="mx-1.5 text-muted">·</span>
                    <span className="text-muted">{host ? '待读取标题' : '微信公众号'}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    已从分享文案里提出链接，立案后读取标题和正文
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!host}
                  onClick={() => setLocked((value) => !value)}
                  className="shrink-0 rounded-full border-2 border-ink bg-brand px-3 py-1 text-xs font-black text-white shadow-ink-sm transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {locked ? '已锁定 ✓' : '锁定链接！'}
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'image' ? (
            <div>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  acceptFile(event.dataTransfer.files[0]);
                }}
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') fileRef.current?.click();
                }}
                className={`relative flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  dragging ? 'border-brand bg-brand-soft' : 'border-ink/55 bg-card'
                }`}
              >
                {file ? (
                  <img
                    src={file.preview}
                    alt={file.name}
                    className="absolute top-3 left-4 h-24 w-20 -rotate-6 rounded-md border-2 border-ink object-cover shadow-ink-sm"
                  />
                ) : null}
                <CameraIcon className="h-8 w-8" />
                <p className="text-sm font-black">把截图甩进来！拖拽 / 点击上传 / ⌘V 粘贴</p>
                <p className="text-xs text-muted">jpg / png / webp，≤5MB，自动压缩</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => acceptFile(event.target.files?.[0])}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                {fileError ? (
                  <span className="font-black text-coral">⚠️ {fileError}</span>
                ) : file ? (
                  <span className="font-bold text-brand-deep">
                    ✓ 已收下 1 张 · {file.name} · {formatSize(file.size)}
                  </span>
                ) : (
                  '支持聊天记录、公众号截图、新闻页面截图'
                )}
              </p>
            </div>
          ) : null}

          {mode === 'video' ? (
            <div>
              <div className="hatch relative flex min-h-[150px] flex-wrap items-center justify-center gap-6 rounded-xl border-2 border-ink p-6">
                <div className="relative">
                  <span className="absolute -top-3 right-2 rotate-3 rounded border border-ink bg-tangerine px-1.5 py-px text-[10px] font-black text-white">
                    开发中
                  </span>
                  <div className="relative grid h-20 w-36 place-items-center rounded-xl border-2 border-ink bg-card">
                    <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-ink bg-brand text-white">
                      <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" fill="currentColor">
                        <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                      </svg>
                    </span>
                    <span className="absolute -top-4 left-6 h-4 w-px -rotate-12 bg-ink" />
                    <span className="absolute -top-4 left-12 h-4 w-px rotate-12 bg-ink" />
                  </div>
                </div>
                <div className="max-w-[240px]">
                  <p className="text-xl font-black">敬请期待！</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    视频查证正在赶来的路上～
                    <br />
                    先试试文字、链接或截图吧
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted">以后：上传短视频，自动提取字幕再查证</p>
            </div>
          ) : null}
        </div>

        {/* 提示 + 立案 */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {!activeCase && mode === 'text' ? (
            textHint ? (
              <p
                role="status"
                className="mr-auto flex items-center gap-1.5 text-xs font-black text-coral"
              >
                ⚠️ {textHint}，暂不能{scriptcheck ? '体检' : '立案'}
              </p>
            ) : (
              <p className="mr-auto flex items-center gap-1.5 text-xs text-muted">
                {scriptcheck ? (
                  <>
                    <span aria-hidden>🧐</span>
                    先免费找疑点，勾选后才开始查证
                  </>
                ) : (
                  <>
                    <ScribbleIcon className="h-3.5 w-3.5" />
                    说出来也行，识别的字会出现在框里，可以再改
                  </>
                )}
              </p>
            )
          ) : null}
          {!activeCase && !scriptcheck && mode === 'text' && !textHint ? (
            <p className="mr-auto w-full text-[11px] font-bold text-muted sm:w-auto">
              消息查证自动预占最多 {FACTCHECK_RESERVE_CLAIMS} 个疑点的积分，结案按实际退回差额。
            </p>
          ) : null}
          {!activeCase && mode === 'link' ? (
            <p className="mr-auto text-xs text-muted">
              公众号、新闻站都行；抖音 / 小红书打不开时建议复制文字
            </p>
          ) : null}

          {formError ? (
            <p role="alert" className="w-full text-right text-xs font-black text-coral">
              ⚠️ {formError}
              {creditShortfall !== null ? (
                <Link
                  href="/credits"
                  className="ml-1 underline decoration-dotted underline-offset-2"
                >
                  去积分中心 →
                </Link>
              ) : null}
            </p>
          ) : null}

          {activeCase ? (
            terminateConfirm ? (
              <>
                <p className="mr-auto flex items-center gap-1.5 text-xs font-black text-coral">
                  ⚠️ 终止后本次查证立即停止，已预占的积分会退回。
                </p>
                <button
                  type="button"
                  onClick={() => setTerminateConfirm(false)}
                  className="rounded-full border-2 border-ink bg-card px-4 py-2 text-sm font-black text-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  再想想
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTerminateConfirm(false);
                    terminateActiveCase();
                  }}
                  className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-coral px-4 py-2 text-sm font-black text-white shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span aria-hidden>■</span>
                  确认终止
                </button>
              </>
            ) : (
              <>
                <p className="mr-auto max-w-[280px] truncate text-xs font-bold text-muted">
                  🕵️ {activeCase.label}
                  {activeCase.input ? `「${activeCase.input}」` : ''}还在办案中，进度不会丢
                </p>
                <button
                  type="button"
                  onClick={() => router.push(activeCase.href)}
                  className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-brand px-5 py-2.5 text-base font-black text-white shadow-ink transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span aria-hidden>⏳</span>
                  正在立案…
                  <span className="text-xs">· 回到办案页 →</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTerminateConfirm(true)}
                  className="rounded-full border-2 border-ink bg-card px-4 py-2 text-sm font-black text-coral shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  终止办案
                </button>
              </>
            )
          ) : (
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
              className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-brand px-6 py-2.5 text-base font-black text-white shadow-ink transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:border-gray disabled:bg-gray-soft disabled:text-gray disabled:shadow-none"
            >
              <span aria-hidden>{submitting ? '⏳' : scriptcheck ? '🔍' : '🕵️'}</span>
              {submitting
                ? mode === 'image'
                  ? '正在整理截图…'
                  : '正在立案…'
                : scriptcheck
                  ? '免费找疑点'
                  : '立案调查'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

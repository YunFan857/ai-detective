'use client';

import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { useRouter } from 'next/navigation';
import { DetectiveMascot } from '@/components/ui/detective-mascot';
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

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function HomeInputCard() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState(
    '喝咖啡会致癌，世卫组织专家已证实！赶紧告诉家人，早上空腹喝的更危险',
  );
  const [url, setUrl] = useState('');
  const [locked, setLocked] = useState(false);
  const [listening, setListening] = useState(false);
  const [file, setFile] = useState<{ name: string; size: number; preview: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (file?.preview) URL.revokeObjectURL(file.preview);
    };
  }, [file]);

  // 图片模式下支持直接 ⌘V 粘贴截图，不必先点虚线框。
  useEffect(() => {
    if (mode !== 'image') return;
    const onPaste = (event: ClipboardEvent) => {
      const next = event.clipboardData?.files[0];
      if (!next) return;
      event.preventDefault();
      const preview = URL.createObjectURL(next);
      setFile((previous) => {
        if (previous) URL.revokeObjectURL(previous.preview);
        return { name: next.name, size: next.size, preview };
      });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [mode]);

  function pickFile(next: File | undefined) {
    if (!next || !next.type.startsWith('image/')) return;
    if (file?.preview) URL.revokeObjectURL(file.preview);
    setFile({ name: next.name, size: next.size, preview: URL.createObjectURL(next) });
  }

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  })();

  const canSubmit =
    (mode === 'text' && text.trim().length > 0) ||
    (mode === 'link' && host.length > 0) ||
    (mode === 'image' && file !== null);

  function handleSubmit() {
    if (!canSubmit) return;
    // TODO(PRD 步骤 2)：立案后先进入疑点清单，接口就绪后改为携带案件参数。
    router.push('/case');
  }

  return (
    <section className="relative mx-auto mt-6 w-full max-w-[860px] px-4 sm:mt-4">
      <div className="relative rounded-[26px] border-[3px] border-ink bg-card p-4 shadow-ink-lg sm:p-5">
        <span className="absolute -top-3 right-7 rotate-6 rounded-md border-2 border-ink bg-coral px-2.5 py-0.5 text-xs font-black text-white shadow-ink-sm">
          报案单
        </span>

        {/* 输入方式 */}
        <div
          role="tablist"
          aria-label="输入方式"
          className="flex flex-wrap items-center gap-2 pr-16 sm:gap-2.5"
        >
          {MODES.map((item) => {
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                role="tab"
                aria-selected={active}
                onClick={() => setMode(item.id)}
                className={`relative flex items-center gap-1.5 rounded-lg border-2 border-ink px-3 py-1.5 text-sm font-bold transition-transform ${
                  active
                    ? 'bg-brand text-white shadow-ink-sm [text-shadow:1px_1px_0_var(--color-ink)]'
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
                onChange={(event) => setText(event.target.value)}
                maxLength={TEXT_LIMIT}
                rows={3}
                aria-label="要查证的消息"
                placeholder="喝咖啡会致癌，世卫组织专家已证实！赶紧告诉家人，早上空腹喝的更危险"
                className="block w-full resize-none bg-transparent pb-8 text-[15px] leading-8 outline-none placeholder:text-muted/80"
              />
              <span className="absolute bottom-3 left-4 text-xs text-muted">
                {text.length} / {TEXT_LIMIT}
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
                  pickFile(event.dataTransfer.files[0]);
                }}
                onPaste={(event) => pickFile(event.clipboardData.files[0])}
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
                  onChange={(event) => pickFile(event.target.files?.[0])}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                {file ? (
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
          {mode === 'text' ? (
            <p className="mr-auto flex items-center gap-1.5 text-xs text-muted">
              <ScribbleIcon className="h-3.5 w-3.5" />
              说出来也行，识别的字会出现在框里，可以再改
            </p>
          ) : null}
          {mode === 'link' ? (
            <p className="mr-auto text-xs text-muted">
              公众号、新闻站都行；抖音 / 小红书打不开时建议复制文字
            </p>
          ) : null}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-brand px-6 py-2.5 text-base font-black text-white shadow-ink transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:border-gray disabled:bg-gray-soft disabled:text-gray disabled:shadow-none"
          >
            <DetectiveMascot className="h-5 w-4" />
            立案调查！
          </button>
        </div>
      </div>
    </section>
  );
}

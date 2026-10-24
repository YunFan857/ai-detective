'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import { ComicButton } from '@/components/ui/comic-button';
import { DetectiveMascot } from '@/components/ui/detective-mascot';

export type ImageFailureDialogProps = {
  open: boolean;
  title: string;
  message: string;
  /** 后端返回的原始错误，折叠展示，便于排查但不抢注意力。 */
  detail?: string;
  onSwitchToText: () => void;
  onRetryUpload: () => void;
};

/**
 * 图片立案失败弹窗：识别失败或收到不可恢复错误时出现。
 * 主操作固定为「改为粘贴文字」，避免用户困在截图里。
 */
export function ImageFailureDialog({
  open,
  title,
  message,
  detail,
  onSwitchToText,
  onRetryUpload,
}: ImageFailureDialogProps) {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onSwitchToText();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSwitchToText, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.12 : 0.2 }}
        >
          <div aria-hidden className="absolute inset-0 bg-scrim" />

          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-failure-title"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
            transition={
              reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 300, damping: 26 }
            }
            className="relative w-[420px] max-w-[calc(100vw-32px)] rounded-[24px] border-[3px] border-ink bg-card px-6 py-6 shadow-ink-lg"
          >
            <DetectiveMascot className="mx-auto w-[84px] -rotate-3" />

            <p className="mt-2 text-center text-xs font-black tracking-wide text-muted">
              图片立案未完成
            </p>
            <h2
              id="image-failure-title"
              className="mt-1 text-center text-xl leading-snug font-black text-ink"
            >
              {title}
            </h2>
            <p className="mt-2 text-center text-sm leading-6 text-muted">{message}</p>

            {detail ? (
              <p
                title={detail}
                className="mt-3 line-clamp-3 rounded-lg border-2 border-ink/15 bg-paper px-3 py-2 text-[11px] leading-5 text-muted"
              >
                {detail}
              </p>
            ) : null}

            <div className="mt-5 grid gap-2">
              <ComicButton variant="brand" onClick={onSwitchToText} className="w-full">
                📝 改为粘贴文字
              </ComicButton>
              <ComicButton variant="white" onClick={onRetryUpload} className="w-full">
                🖼️ 重新上传截图
              </ComicButton>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

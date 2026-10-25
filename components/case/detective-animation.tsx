'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

/** 三支透明 WebM：敬礼点头、跑步、递报告（VP9 alpha）。 */
const CLIP_SRC = {
  salute: '/videos/salute.webm',
  running: '/videos/running.webm',
  report: '/videos/report.webm',
} as const;

export type DetectiveClip = keyof typeof CLIP_SRC;

export type DetectiveAnimationProps = {
  clip: DetectiveClip;
  /** 换成新值时从头播放；null 表示暂停，等下一次触发。 */
  playKey: string | number | null;
  /** 仅跑步循环；敬礼与递报告播完停在末帧。 */
  loop?: boolean;
  /** 正方形边长（px），透明背景、object-fit: contain。 */
  size?: number;
  className?: string;
  onEnded?: () => void;
  /** 解码 / 播放失败：调用方回退静态头像。 */
  onUnavailable?: () => void;
};

/**
 * 侦探透明动画播放器：只负责按 key 播放、循环、停在末帧和卸载清理。
 * 何时播由办案状态与事件决定，组件本身不猜流程、不加固定延时。
 */
export function DetectiveAnimation({
  clip,
  playKey,
  loop = false,
  size = 56,
  className,
  onEnded,
  onUnavailable,
}: DetectiveAnimationProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  // 播放 / 重播 / 暂停：playKey 变化时从头开始。
  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;

    if (playKey === null) {
      video.pause();
      return;
    }

    const start = (): void => {
      if (video.readyState >= 1) {
        try {
          video.currentTime = 0;
        } catch {
          // 元数据尚未就绪时忽略，直接播即可。
        }
      }
      const playing = video.play();
      if (playing) {
        void playing.catch((error: unknown) => {
          // 被卸载 / 暂停打断不算播放失败，只有真正的自动播放或解码失败才回退。
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setFailed(true);
        });
      }
    };

    if (video.readyState >= 1) {
      start();
      return;
    }

    const handleLoaded = (): void => start();
    video.addEventListener('loadedmetadata', handleLoaded, { once: true });
    return () => video.removeEventListener('loadedmetadata', handleLoaded);
  }, [failed, playKey]);

  // 卸载时暂停，避免连续办案残留后台播放。
  // 不摘除 src：开发模式 StrictMode 会模拟一次卸载再挂载，摘掉后 React 不会重新赋值。
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      video?.pause();
    };
  }, []);

  if (failed) return null;

  return (
    <video
      ref={videoRef}
      src={CLIP_SRC[clip]}
      muted
      playsInline
      loop={loop}
      preload="auto"
      aria-hidden
      tabIndex={-1}
      draggable={false}
      onEnded={onEnded}
      onError={() => {
        setFailed(true);
        onUnavailable?.();
      }}
      className={clsx('pointer-events-none shrink-0 object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}

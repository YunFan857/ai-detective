import type { ImgHTMLAttributes } from 'react';

export type DetectiveMascotProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
  /** yawn：同一只小侦探，右上角飘 Zzz，用于「没有可核查的事实」「失败」等空状态。 */
  mood?: 'default' | 'yawn';
};

/**
 * 侦探社吉祥物：统一使用新版 2D 小侦探位图
 * （public/images/detective-logo.png，512×512 透明底）。
 * 不再保留旧的绿脸棕帽 SVG；yawn 态在同一张图上叠加 Zzz，不另绘形象。
 */
export function DetectiveMascot({
  className,
  mood = 'default',
  style,
  ...props
}: DetectiveMascotProps) {
  const image = (
    <img
      src="/images/detective-logo.png"
      alt=""
      aria-hidden
      draggable={false}
      className={`aspect-square object-contain ${mood === 'yawn' ? 'h-full w-full' : (className ?? '')}`}
      style={mood === 'yawn' ? undefined : style}
      {...(mood === 'yawn' ? {} : props)}
    />
  );

  if (mood !== 'yawn') return image;

  return (
    <span aria-hidden className={`relative inline-block aspect-square ${className ?? ''}`} style={style}>
      {image}
      <svg
        viewBox="0 0 40 40"
        fill="none"
        className="absolute -top-[6%] -right-[8%] h-[34%] w-[34%]"
        stroke="var(--color-ink)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 18h13l-13 13h13" />
        <path d="M24 4h9l-9 9h9" />
      </svg>
    </span>
  );
}

import type { ImgHTMLAttributes } from 'react';

export type DetectiveMascotProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
  /** yawn：同一只小侦探，右上角飘 Zzz，用于「没有可核查的事实」「失败」等空状态。 */
  mood?: 'default' | 'yawn';
  /**
   * full：完整半身图，适合 56px 以上；avatar：头部裁切，适合 24–48px。
   * 两张图都来自同一张「侦探2d」角色，透明底，不拉伸、不裁掉帽子与单片镜。
   */
  variant?: 'full' | 'avatar';
};

/**
 * 侦探社吉祥物：统一使用新版 2D 小侦探位图。
 * 大尺寸用 public/images/detective-logo.png（完整半身），
 * 小尺寸用 public/images/detective-avatar.png（头部裁切）。
 * 不再保留旧的绿脸棕帽 SVG；yawn 态在同一张图上叠加 Zzz，不另绘形象。
 */
export function DetectiveMascot({
  className,
  mood = 'default',
  variant = 'full',
  style,
  ...props
}: DetectiveMascotProps) {
  const src = variant === 'avatar' ? '/images/detective-avatar.png' : '/images/detective-logo.png';
  const image = (
    <img
      src={src}
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
    <span
      aria-hidden
      className={`relative inline-block aspect-square ${className ?? ''}`}
      style={style}
    >
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

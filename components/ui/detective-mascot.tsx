import type { SVGProps } from 'react';

export type DetectiveMascotProps = SVGProps<SVGSVGElement> & {
  /** yawn：闭眼张嘴打哈欠，用于「没有可核查的事实」的空状态。 */
  mood?: 'default' | 'yawn';
};

/**
 * 侦探社吉祥物。
 * default：使用新版 2D 小侦探 logo 位图（public/images/detective-logo.png，512×512 透明底）。
 * yawn：新图没有打哈欠表情，保留纯 SVG 绘制。
 */
export function DetectiveMascot({
  className,
  mood = 'default',
  ...props
}: DetectiveMascotProps) {
  const yawning = mood === 'yawn';

  if (!yawning) {
    return (
      <img
        src="/images/detective-logo.png"
        alt=""
        aria-hidden
        draggable={false}
        className={`aspect-square object-contain ${className ?? ''}`}
      />
    );
  }

  return (
    <svg viewBox="0 0 140 150" fill="none" className={className} aria-hidden {...props}>
      {/* 脸 */}
      <circle cx="70" cy="100" r="40" fill="#43b862" stroke="#1c1c1c" strokeWidth="4" />

      {/* 帽冠与帽檐，压住脸的顶部 */}
      <path
        d="M40 60C37 34 47 22 70 22C93 22 103 34 100 60Z"
        fill="#855536"
        stroke="#1c1c1c"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M42 48C54 54 86 54 98 48L99 57C86 63 54 63 41 57Z"
        fill="#33251a"
        stroke="#1c1c1c"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <ellipse cx="70" cy="60" rx="46" ry="12" fill="#6f4529" stroke="#1c1c1c" strokeWidth="4" />

      {/* 闭眼 */}
      <path d="M46 98C52 91 60 91 66 98" stroke="#1c1c1c" strokeWidth="4" strokeLinecap="round" />
      <path d="M76 98C82 91 90 91 96 98" stroke="#1c1c1c" strokeWidth="4" strokeLinecap="round" />

      {/* 腮红 */}
      <ellipse cx="41" cy="113" rx="7" ry="4" fill="#7fd39a" />
      <ellipse cx="99" cy="113" rx="7" ry="4" fill="#7fd39a" />

      {/* 张开的嘴 */}
      <ellipse cx="70" cy="119" rx="10" ry="7" fill="#1c1c1c" stroke="#1c1c1c" strokeWidth="3" />

      {/* 飘出的 Zzz */}
      <g stroke="#1c1c1c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M106 28h9l-9 9h9" />
        <path d="M120 13h6l-6 6h6" />
      </g>
    </svg>
  );
}

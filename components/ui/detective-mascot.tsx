import type { SVGProps } from 'react';

export type DetectiveMascotProps = SVGProps<SVGSVGElement> & {
  /** yawn：闭眼张嘴打哈欠，用于「没有可核查的事实」的空状态。 */
  mood?: 'default' | 'yawn';
};

/**
 * 侦探社吉祥物：绿脸 + 棕色礼帽。
 * 纯 SVG 绘制，避免位图在不同分辨率下发虚。
 */
export function DetectiveMascot({
  className,
  mood = 'default',
  ...props
}: DetectiveMascotProps) {
  const yawning = mood === 'yawn';

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

      {yawning ? (
        <>
          {/* 闭眼 */}
          <path
            d="M46 98C52 91 60 91 66 98"
            stroke="#1c1c1c"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M76 98C82 91 90 91 96 98"
            stroke="#1c1c1c"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          {/* 眼睛 */}
          <ellipse cx="56" cy="97" rx="10" ry="11" fill="#fff" stroke="#1c1c1c" strokeWidth="3" />
          <ellipse cx="85" cy="97" rx="10" ry="11" fill="#fff" stroke="#1c1c1c" strokeWidth="3" />
          <circle cx="53" cy="99" r="4.5" fill="#1c1c1c" />
          <circle cx="82" cy="99" r="4.5" fill="#1c1c1c" />
        </>
      )}

      {/* 腮红 */}
      <ellipse cx="41" cy="113" rx="7" ry="4" fill="#7fd39a" />
      <ellipse cx="99" cy="113" rx="7" ry="4" fill="#7fd39a" />

      {/* 嘴：打哈欠时张开 */}
      {yawning ? (
        <ellipse
          cx="70"
          cy="119"
          rx="10"
          ry="7"
          fill="#1c1c1c"
          stroke="#1c1c1c"
          strokeWidth="3"
        />
      ) : (
        <path
          d="M60 116C65 125 75 125 80 116"
          stroke="#1c1c1c"
          strokeWidth="4"
          strokeLinecap="round"
        />
      )}

      {/* 打哈欠时飘出的 Zzz */}
      {yawning ? (
        <g stroke="#1c1c1c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M106 28h9l-9 9h9" />
          <path d="M120 13h6l-6 6h6" />
        </g>
      ) : null}
    </svg>
  );
}

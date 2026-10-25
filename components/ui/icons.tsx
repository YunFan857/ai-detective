import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** 文字输入 */
export function PencilIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="M13 6.5 17.5 11" />
    </svg>
  );
}

/** 链接输入 */
export function LinkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.3" />
      <path d="M14 10.5a4 4 0 0 0-5.7 0L5.5 13.3a4 4 0 0 0 5.7 5.7l1.3-1.3" />
    </svg>
  );
}

/** 图片输入 */
export function PictureIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 17 4.7-4.6 3.3 3.1 3-2.8L20 16" />
    </svg>
  );
}

/** 视频输入 */
export function VideoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="m16 10.5 4.2-2.4a.8.8 0 0 1 1.2.7v6.4a.8.8 0 0 1-1.2.7L16 13.5" />
    </svg>
  );
}

/** 麦克风 */
export function MicIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

/** 相机 */
export function CameraIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8.5h3l1.5-2h7L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5Z" />
      <circle cx="12" cy="14" r="3.4" />
    </svg>
  );
}

/** 卷宗文件夹 */
export function FolderIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M2.5 6.2c0-1 .8-1.8 1.8-1.8h4.4l2 2.2h7.9c1 0 1.9.8 1.9 1.9v7.8c0 1-.9 1.8-1.9 1.8H4.3c-1 0-1.8-.8-1.8-1.8V6.2Z" />
    </svg>
  );
}

/** 返回首页 */
export function HomeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

/** 铅笔小提示 */
export function ScribbleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 19.5 5.2 15l9.4-9.4a2 2 0 0 1 2.8 2.8L8 17.8l-4 1.7Z" />
    </svg>
  );
}

/** 元宝搜索的叶形标记 */
export function LeafMark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <circle cx="12" cy="12" r="10" fill="#28a95b" />
      <path
        d="M16.8 7.4c-5.6.3-8.7 2.9-8.7 6.4 0 1 .3 1.8.8 2.4 1.6-3 3.8-4.9 6.6-5.8-2.3 1.4-4.2 3.4-5.3 5.9.5.2 1.1.3 1.7.3 3.6 0 5.4-4 4.9-9.2Z"
        fill="#fff"
      />
    </svg>
  );
}

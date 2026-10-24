import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

/**
 * Google Fonts 在部分网络环境不可达，因此把 Noto Sans SC 自托管在 public/fonts。
 * 400 正文 / 700 小标题与按钮 / 900 花字与印章。
 */
const noto = localFont({
  src: [
    {
      path: '../public/fonts/noto-sans-sc/NotoSansSC-Regular.ttf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../public/fonts/noto-sans-sc/NotoSansSC-Bold.ttf',
      weight: '700',
      style: 'normal',
    },
    {
      path: '../public/fonts/noto-sans-sc/NotoSansSC-Black.ttf',
      weight: '900',
      style: 'normal',
    },
  ],
  variable: '--font-noto',
  display: 'swap',
  // 中文字体体积大，交给 CSS 按需加载，不做 30MB 的全量 preload。
  preload: false,
  adjustFontFallback: false,
  fallback: ['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'AI 侦探社 · 结案卷宗',
  description: '输入一条消息，查清它的来路。拆疑点、搜证、溯源，给出可追溯出处的结案卷宗。',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" className={`${noto.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

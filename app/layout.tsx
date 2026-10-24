import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI 侦探社 · 结案卷宗',
  description: '输入一条消息，查清它的来路。拆疑点、搜证、溯源，给出可追溯出处的结案卷宗。',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

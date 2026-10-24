# 前端细则（负责人 B）

> 上位文件是 [AGENTS.md](../AGENTS.md)。本文件只补充前端落地细节，冲突时以 AGENTS.md 为准。

## 1. 组件

- 一个文件一个组件，文件名小写连字符（如 `case-broadcast.tsx`），导出 PascalCase（如 `CaseBroadcast`）。
- 需要 state、effect 或浏览器 API 的组件，文件首行写 `'use client';`。
- `app/*/page.tsx` 只做拼装：组合 `components/` 里的组件，不写请求、不写状态机、不写数据映射。
- 组件按归属放置：`components/ui/`（无业务的基础件）、`components/home/`（首页）、`components/case/`（卷宗页）。
- props 用显式类型，禁止 `any`；跨组件的数据形状直接复用 `types/case.ts` 的导出类型。

## 2. 样式

- 只用 Tailwind 工具类和 `app/globals.css` 里的 token，禁止写死色值（`text-[#e8b22b]`、`style={{ color: '#...' }}` 都不允许）。
- 现有 token：`paper`、`paper-deep`、`card`、`beige`、`ink`、`brand`、`brand-deep`、`brand-soft`、`coral`、`coral-soft`、`tangerine`、`tangerine-soft`、`sky`、`sky-soft`、`muted`；硬投影 `shadow-ink`、`shadow-ink-sm`、`shadow-ink-lg`；圆角 `radius-ink`。
- 描边、硬投影、花字统一用工具类：`.comic-card`（卡片描边 + 硬投影）、`.huazi`（标题花字）；页面背景用 `.paper-bg`，等待态用 `.hatch`。
  - `globals.css` 已定义 `.paper-bg`、`.ink-title`、`.comic-card`、`.comic-card-green`、`.huazi`、`.hatch`、`.wave-bar`，统一使用，禁止在各组件里重复拼一套。
- 新工具类只能加在 `app/globals.css`，命名小写连字符；不引入 CSS Module 或 styled-components。
- SVG 图标 / 插画允许用 `fill`、`stroke`，但优先引用 `--color-*` 变量，不新增散落的十六进制色值。

## 3. 数据

- 页面和组件只通过 `useInvestigation()`（`lib/use-investigation.ts`）取调查数据；开发期由 `lib/mock-stream.ts` 提供 mock 事件。
- 不直接 `fetch('/api/...')`，不直接实例化大模型 SDK，不直接读 `cache/`。
- 所有字段按可缺省处理：可选链 + 默认值，并给占位文案（如「待补充」「暂无出处」）；字段缺失不允许白屏或抛错。
- 枚举（判决档位、来源等级、阶段）的中文文案和配色只从 `lib/labels.ts` 取，组件内不得再写一份 `Record<...>` 映射。

## 4. 动效

- 统一使用 `framer-motion`，不用手写大量 CSS keyframes 做入场 / 切换。
- 所有动效必须尊重 `prefers-reduced-motion`：用 `useReducedMotion()` 关闭位移、缩放和循环动画，只保留透明度变化。
- 动效服务于状态变化（阶段推进、新证据入场），不做纯装饰的长时间循环。
- 注意：`package.json` 已声明 `framer-motion`，需要新增其他依赖时仍先与 A 确认，不要自行安装。

## 5. 原型图

开发每个页面前，先看 `docs/ui-ref/` 对应原型，再动手：

| 页面 / 模块 | 原型图 |
| --- | --- |
| 首页（文字 / 链接 / 图片 / 视频） | `01-home-text.png` ~ `04-home-video.png` |
| 卷宗页 | `05a-case.png` ~ `05e-case.png` |
| 疑点清单（进度 / 挑选 / 自动运行） | `06-claims-progress.png`、`07-claims-pick.png`、`07b-autorun.png` |
| 定价页 | `08-pricing.png` |

原型与文案不一致时以原型为准，先按原型实现，再找 A 对齐。

## 6. 边界

以下文件 / 目录只读，不修改：

- `types/`、`mock/`：共享契约，只增不改。
- `lib/pipeline/`、`app/api/`：A 的地盘。
- `lib/llm.ts`、`lib/yuanbao.ts`、`lib/tiers.ts`、`lib/replay.ts`、`cache/`、`scripts/`：后端实现。

确实需要改动时，先停止编码，把「文件 + 想改什么 + 为什么」列出来告诉 A，确认后再动。

## 7. 交接

- 每次会话结束前，把进展写进 `docs/handoff-b.md`：完成了什么、改了哪些文件、当前卡点、下一步。
- 新会话开始先读 `docs/handoff-b.md`，再读本文件和 `AGENTS.md`。
- 该文件只记录前端（B）进度，不写后端细节。

## 8. 提交前自查

- `pnpm build` 通过。
- `pnpm lint` 无新增 error。
- 没有新增写死色值；页面里没有业务逻辑；没有出现 `any`。
- 列出本次改动的文件。

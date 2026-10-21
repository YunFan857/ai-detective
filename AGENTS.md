<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AI 侦探社 · 结案卷宗

## 项目目标

用户输入一条消息，系统用元宝搜索 API 完成「拆解疑点 → 正反搜证 → 来源分级与同源合并 → 溯源变形时间线 → 五档判决」，输出可追溯出处的结案卷宗。

## 目录归属

| 目录 / 文件                                                       | 归属 | 说明                            |
| ----------------------------------------------------------------- | ---- | ------------------------------- |
| `app/api/investigate/route.ts`                                    | A    | 立案接口                        |
| `app/api/case/[id]/route.ts`                                      | A    | 卷宗读取接口                    |
| `lib/pipeline/`                                                   | A    | 流水线阶段，每阶段一个文件      |
| `lib/llm.ts`                                                      | A    | 大模型调用唯一入口              |
| `lib/yuanbao.ts`                                                  | A    | 元宝搜索唯一入口                |
| `lib/tiers.ts`                                                    | A    | 来源分级与同源合并              |
| `lib/replay.ts`                                                   | A    | 溯源时间线与卷宗回放            |
| `scripts/`                                                        | A    | 命令行脚本                      |
| `cache/`                                                          | A    | 演示卷宗（需提交）              |
| `docs/backend-rules.md`                                           | A    | 后端细则                        |
| `app/page.tsx`、`app/case/page.tsx`、`app/styleguide/page.tsx`    | B    | 页面                            |
| `components/ui/`、`components/home/`、`components/case/`          | B    | 组件                            |
| `lib/use-investigation.ts`、`lib/mock-stream.ts`、`lib/labels.ts` | B    | 前端 Hook / mock / 文案         |
| `public/fonts/`、`public/images/`                                 | B    | 静态资源                        |
| `docs/frontend-rules.md`                                          | B    | 前端细则                        |
| `types/case.ts`、`mock/`                                          | 共享 | 契约，只增不改                  |
| `docs/yuanbao-api.md`、`docs/ui-ref/`、`docs/ai-logs/`            | 共享 | 接口文档、视觉参考、AI 对话导出 |

## 编码规范

- TypeScript `strict` 开启，禁止 `any`；不确定的类型用 `unknown` + zod 收窄。
- 大模型输出必须经 zod 校验后才能进入业务逻辑。
- 文件名小写连字符（如 `use-investigation.ts`）；React 组件导出 PascalCase。
- 不得提交任何密钥，只提交 `.env.example`。
- 统一使用 pnpm，Node 20。

## 调用规范

- 所有大模型调用只走 `lib/llm.ts`，业务代码不得直接实例化 SDK。
- 所有搜索只走 `lib/yuanbao.ts`，单案搜索 ≤10 次。
- 开发期走本地缓存（`USE_MOCK=true` 与 `cache/`），避免消耗额度。

## 契约规则

- `types/` 与 `mock/` 只增不改。
- 确需修改时，先通知对方，并在 PR 模板中勾选「是否改契约」。

## Git 规范

- `main` 永远可运行。
- 分支命名：`a/xxx`（后端）、`b/xxx`（前端）。
- 提交信息：`feat|fix|chore(范围): 中文说明`。
- 合并前 `pnpm build` 必须通过。

## AI 协作规则

- 动手前先读本文件。
- 只改自己地盘的文件，跨边界修改先沟通。
- 每步结束列出本次改动的文件。
- 后端细则见 [docs/backend-rules.md](docs/backend-rules.md)，前端细则见 [docs/frontend-rules.md](docs/frontend-rules.md)。

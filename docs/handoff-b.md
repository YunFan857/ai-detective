# 前端交接（负责人 B）

> 上位文件：[AGENTS.md](../AGENTS.md)、[frontend-rules.md](frontend-rules.md)。
> 本文件只记录前端进度，后端改动需求集中写在「六、需 A 配合」。

## 一、本次完成

「文案体检」免费预检链路（原型 06 / 07）已接通真实接口：

- 首页新增业务模式切换「📰 消息查证 / 🎬 文案体检（免费）」。文案体检限 50–1500 字，消息查证保持原 4–500 字。
- 提交后写入版本化 `sessionStorage` 草稿，跳转 `/claims`，立刻请求 `POST /api/extract-claims`（`mode:"scriptcheck"`、`inputType:"text"`）。
- ⑥ `/claims` 等待页：左侧原文 + 字数 + 扫描线（明确标注「只是等待动效，不代表逐句进度」），右侧五步说明 + 侦探播报，底部固定「免费 · 不调用元宝搜索 · 不扣积分」与「取消，返回编辑」。
- ⑦ 勾选页：原文按 span 上色（高=红 / 中=橙 / 低=灰，虚线 +「AI 初判 · 待查证」），右侧按风险排序的疑点卡片，左右联动（点击、键盘 Enter/Space、hover/focus 均可查看风险、类别、信号、后果）。
- 选择规则：默认只勾高风险；高风险 >10 时只选排序前 10 并提示；无高风险默认不选；提供「只选高风险 / 全选 / 清空」，全选封顶 10 个；已选 10 个时仍可取消、不可新增。
- span 校验：UTF-16 下标、end 开区间；缺失 / 越界 / 与 `sentence` 不一致的疑点不上色，卡片保留并标注「暂无法定位原文」；重叠区间合并为一个可访问标记，关联多个疑点。
- 结算栏只显示真实 `pricePerClaim` 与「已选 N 个 · 将扣 N×单价 积分」，并标注「演示模式 · 暂未启用积分账户，未真实扣款」；未硬编码余额、未做充值/过期。
- 确认后写入版本化交接，跳转 `/case?flow=scriptcheck`；`lib/use-investigation.ts` 新增 `flow:'preview'` 请求形态，显式携带 `mode:"scriptcheck"`、`previewId`、`selectedClaimIds`，并接收 `claim_progress` 与 `billing`。
- 防重复：交接只读一次即删；StrictMode / 刷新 / 前进后退不会重复开查；「开始查证」按钮有 `confirming` 锁，防双击重复扣费。
- 预检请求有 `AbortController` + 120s 超时 + 序号校验，取消 / 返回编辑 / 新文本重跑时旧响应不会覆盖新结果。

## 二、改动文件

新增：

- `lib/claims-intake.ts`（版本化 sessionStorage 草稿 / 交接，zod 校验）
- `lib/claims-selection.ts`（默认勾选、排序、上限、统计）
- `lib/claims-span.ts`（span 校验、重叠合并、无法定位归集）
- `lib/use-claims-check.ts`（⑥/⑦ 状态机与预检请求）
- `components/claims/claims-top-bar.tsx`
- `components/claims/claims-state-card.tsx`
- `components/claims/claims-progress.tsx`（⑥）
- `components/claims/claims-pick.tsx`（⑦）
- `components/claims/claims-workspace.tsx`
- `app/claims/page.tsx`
- `docs/handoff-b.md`（本文件）

修改：

- `components/home/home-input-card.tsx`：业务模式页签、50–1500 字校验、草稿回填与跳转
- `lib/use-investigation.ts`：`flow:'preview'` 请求形态、`claimProgress` / `billing` 状态
- `app/case/page.tsx`：`flow=scriptcheck` 交接读取、立案说明、失效兜底卡片
- `lib/labels.ts`：`CLAIM_CATEGORY_LABELS` / `claimCategoryLabel()`

未改动：`app/api/`、`lib/pipeline/`、`types/`、`mock/`、`cache/`、`scripts/`。

## 三、入口与操作路径

首页 → 选「🎬 文案体检」→ 粘贴 50–1500 字 → 「🔍 免费找疑点」→ ⑥ 等待 → ⑦ 勾选 → 「开始查证」→ `/case?flow=scriptcheck` 查证到结案。

返回编辑：⑥/⑦ 的「返回编辑」→ `/?intake=scriptcheck`，草稿回填；改完文本必须重新预检，旧 `previewId` 不复用。

原有入口保持：文字立案（4–500 字）、链接立案、图片立案两步确认、mock / demo 卷宗、`/debug`、`/styleguide`。

## 四、自查结果

- `pnpm lint`：0 error（9 条既有 warning，含 `<img>` 与 `scripts/tmp-verify-opc.mts`）
- `pnpm typecheck`：通过
- `pnpm build`：通过，`/claims` 静态预渲染，`/case` 保持静态
- 已用真实接口与拦截 fixture 验证：0 疑点、无高风险、>10 疑点、重叠 span、缺失/越界/句子不一致 span、双击防重、刷新不重开、返回编辑回填
- 已用 390px 视口模拟手机宽度：两栏纵向堆叠、无横向溢出、卡片勾选联动正常；底栏改为 `fixed` + `env(safe-area-inset-bottom)`，页面留白加大到 `pb-44`（桌面 `pb-36`），避免遮挡最后一张卡片
- 新标签直接访问 `/case?flow=scriptcheck`：显示「疑点清单已失效」卡片，「重新体检」→ `/claims`、「返回首页」→ `/`，且不发出 `/api/investigate`
- 未做的实测：预检失败/重试与旧响应覆盖的浏览器实测（代码已做 AbortController + 序号校验）、`prefers-reduced-motion` 实机验证

## 五、暂未覆盖

- 积分账户模块尚未存在：结算栏只展示估算与「暂未启用积分账户」，无余额、无不足拦截、无真实扣款。`billing` 事件已接入状态，等积分模块落地即可在此基础上结算。⑦b 在无真实账户时同样显示「积分账户尚未接入」，不启动自动开查，只保留手动入口。
- 06 的「逐句扫描」不可实现：`extract-claims` 是一次性 JSON，前端不伪造进度，只保留明确标注的等待动效。
- 07b 已由「3 秒」改为「30 秒」，详见第八节。

## 六、需 A 配合

1. mock 模式下预检 id 与目录不一致：`mock/claims-preview-script.json` 的 `previewId` 是 `preview-script-001`，而 `loadPreview` 查 `.cache/previews`、`cache/`、`cache/preview-*.json`，现有缓存文件 id 是 `bc2a24ce`。`USE_MOCK=true` 演示时 `/api/investigate` 可能返回 404 `preview_not_found`，需统一 id 或落盘位置。
2. `/api/investigate` 允许省略 `selectedClaimIds`（省略即全查）。前端始终显式传，但建议服务端在 `mode:"scriptcheck"` 且 `previewId` 存在时强制要求该字段，避免误全量扣费。
3. `extract-claims` 无流式进度，若后续要展示真实逐句进度，需要新增 SSE 或分句回传接口。
4. 需要积分账户接口（余额查询 + 扣费/退款口径），前端才能展示余额、拦截不足，并把 `billing` 与 `done` 的重复结算去重。
5. `/api/extract-claims` 偶发 `HTTP 500 · 模型返回内容为空`（`lib/llm.ts` 的 `EMPTY_CONTENT`）。接口本身可用：同一文案复测 200、约 23s。疑似上游 `deepseek-flash` 思维链吃光 `max_tokens`、`response_format: json_object` 网关兼容或限流，建议 A：对空内容自动重试、日志记录 `finish_reason`、必要时换 `LLM_MODEL`。

## 七、优化记录（logo / 顶栏 / 500 文案）

- `public/images/detective-logo.png` 换为新 2D 小侦探（`侦探2d.jpg` 抠白底，512×512 透明）。品牌位 4 处引用自动生效。
- `components/ui/detective-mascot.tsx`：`default` 态改渲染该位图，`yawn` 态因新图无打哈欠表情保留 SVG；调用方 className 不变。
- `components/claims/claims-top-bar.tsx`：顶栏 `bg-ink` → `bg-brand`（元宝绿），描边、阴影保持，文字/边框对比度同步调整。
- `lib/use-claims-check.ts`：5xx 文案改为说明“上游模型偶发无结果，重试即可”。
- 截图：`screenshots/opt-*.jpg`。

## 八、⑦b 疑点 1–2 个 · 30 秒后自动开查

### 已确定的行为

- **⑦b 已改为 30 秒**：先完整展示费用提示与「取消 / 立即开始」，再逐秒倒计时 30 秒；原型图里的 3 秒全部作废。
- **取消后保留原文、返回编辑**：取消只作废计时器与已排队回调，不查证、不扣积分；原文保持可编辑，免费预检结果与风险标记保留为只读参考。
- **同一预览取消后不再自动倒计时**：按 `draftId + previewId` 记录取消标记（`sessionStorage`，zod 校验），rerender、切后台、路由返回、刷新都只进入手动确认，不静默恢复自动开查。
- **未改文案可手动开查，改过文案必须重新免费体检**：手动开始复用原 `previewId` 与 `selectedClaimIds`，不重新预检、不再倒计时；文案任意变动（含标点、首尾空白，逐字比较、不 trim）立即进入 `stale`，只能「重新免费体检」，拿到新预览后才重新分流/倒计时。

### 分流规则

- 0 疑点 → 不查证、不倒计时，明确提示不扣积分。
- 1–2 疑点且 `autoRun=true` → ⑦b 自动开查。
- ≥3 疑点 → ⑦ 多疑点选择页（原有逻辑不变）。
- `autoRun` 与疑点数量不一致、id 缺失/重复、非 `scriptcheck`/`text`、文案与预览不一致 → 回退 ⑦ 手动确认。

### 接入方式（复用 ⑥⑦，不重写）

- 复用 `useClaimsCheck` 的预览、`previewId`、`pricePerClaim`、积分/计费入口，以及 `ClaimMarkedText` 原文标记组件（⑦ 与 ⑦b 共用，不另写 span 渲染）。
- 只新增分流与倒计时层：`lib/claims-autorun-flow.ts`（分流 + 会话标记）、`lib/claims-autorun-controller.ts`（纯 TS 状态机，注入时钟便于假时钟验证）、`lib/use-claims-autorun.ts`（React 接入）、`lib/credits.ts`（积分只读视图）、`components/claims/claims-autorun.tsx`（⑦b UI）、`components/claims/claim-marked-text.tsx`（共享标记）。
- 到点、立即开始、取消后手动开始共用 `startOnce()`：先同步置锁 → 清计时器 → 校验文案版本 / `previewId` / 余额 / 疑点数量 → 只启动一次；启动请求仍是 `POST /api/investigate` `{ mode:<preview.mode>, inputType:<preview.inputType>, previewId, selectedClaimIds }`，后续沿用现有办案页 / SSE / 判决书。
- 未改动 `app/api/`、`lib/pipeline/`、`types/`、`mock/`、`cache/`、`scripts/`。

### 待配合

- 需要积分账户接口（余额查询 + 扣费/退款口径）：当前 `lib/credits.ts` 默认 `unavailable`，⑦b 只显示「积分账户尚未接入」并保留手动入口，不会伪造余额；开发期可用 `?demoCredits=38` 或 `sessionStorage['claims:demo-credits']` 走演示余额，生产构建关闭。
- 前端锁只保证本页面单次启动，**不等价于服务端幂等**；建议 `previewId + selectedClaimIds` 在服务端做幂等键，避免重复计费。
- `POST /api/investigate` 的 404 `preview_not_found`（预览过期/缓存被清）前端提示重新体检，不自动重启倒计时；网络失败显示错误 + 手动重试。

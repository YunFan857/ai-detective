# 前端交接（负责人 B）

> 上位文件：[AGENTS.md](../AGENTS.md)、[frontend-rules.md](frontend-rules.md)。
> 本文件只记录前端进度，后端改动需求集中写在「六、需 A 配合」。
> 最新进展：第九节（积分中心与本地积分账本）、第十节（新侦探形象）、第十一节（需 A 配合的积分口径）。

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

- （历史）积分账户模块当时尚未存在：结算栏只展示估算与「暂未启用积分账户」，无余额、无不足拦截、无真实扣款。现在已由第九节的本地演示账本补齐余额、签到、预占、扣费与退回；真实账户接口仍需 A。
- 06 的「逐句扫描」不可实现：`extract-claims` 是一次性 JSON，前端不伪造进度，只保留明确标注的等待动效。
- 07b 已由「3 秒」改为「30 秒」，详见第八节。

## 六、需 A 配合

1. mock 模式下预检 id 与目录不一致：`mock/claims-preview-script.json` 的 `previewId` 是 `preview-script-001`，而 `loadPreview` 查 `.cache/previews`、`cache/`、`cache/preview-*.json`，现有缓存文件 id 是 `bc2a24ce`。`USE_MOCK=true` 演示时 `/api/investigate` 可能返回 404 `preview_not_found`，需统一 id 或落盘位置。
2. `/api/investigate` 允许省略 `selectedClaimIds`（省略即全查）。前端始终显式传，但建议服务端在 `mode:"scriptcheck"` 且 `previewId` 存在时强制要求该字段，避免误全量扣费。
3. `extract-claims` 无流式进度，若后续要展示真实逐句进度，需要新增 SSE 或分句回传接口。
4. （历史）需要真实积分账户接口（余额查询 + 扣费/退款口径）。本地演示账本、余额展示、不足拦截与 `billing` / `done` 去重已在第九节落地；真实钱包接口仍需 A。
5. `/api/extract-claims` 偶发 `HTTP 500 · 模型返回内容为空`（`lib/llm.ts` 的 `EMPTY_CONTENT`）。接口本身可用：同一文案复测 200、约 23s。疑似上游 `deepseek-flash` 思维链吃光 `max_tokens`、`response_format: json_object` 网关兼容或限流，建议 A：对空内容自动重试、日志记录 `finish_reason`、必要时换 `LLM_MODEL`。

## 七、优化记录（logo / 顶栏 / 500 文案）

- `public/images/detective-logo.png` 换为新 2D 小侦探（`侦探2d.jpg` 抠白底，512×512 透明）。品牌位 4 处引用自动生效。
- `components/ui/detective-mascot.tsx`：`default` / `yawn` 都渲染新位图，`yawn` 只在同一张图上叠加 Zzz；新增 `variant="avatar"` 使用头部裁切图 `detective-avatar.png`，小尺寸调用方已切换，不再保留旧绿脸 SVG。
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

- （历史）需要真实积分账户接口（余额查询 + 扣费/退款口径）。现在 `lib/credits.ts` 已接本地 localStorage 账本（第九节），`?demoCredits` / `claims:demo-credits` 临时余额已移除；真实钱包接口仍需 A。
- 前端锁只保证本页面单次启动，**不等价于服务端幂等**；建议 `previewId + selectedClaimIds` 在服务端做幂等键，避免重复计费。
- `POST /api/investigate` 的 404 `preview_not_found`（预览过期/缓存被清）前端提示重新体检，不自动重启倒计时；网络失败显示错误 + 手动重试。

## 九、积分中心 ⑧ 与本地积分账本

### 已完成

- 新增 `/credits`：桌面三栏「我的积分 / 购买积分 / 确认订单」，手机纵向堆叠；视觉沿用元宝绿、浅薄荷纸面、墨色描边、硬投影与圆角 token。
- 本地积分 store（`lib/credits-store.ts`）：
  - localStorage 键 `ai-detective:credits:v1`，带 `version: 1` 与 zod 结构校验。
  - 首次初始化赠送 120 积分，只初始化一次；明确标注为演示赠送。
  - 赠送批次与模拟充值批次分开；赠送积分有效期 7 个自然日，按 `Asia/Shanghai` 计算到期日 23:59:59，到期惰性失效并写流水。
  - 扣费顺序：先扣最快过期的赠送积分，再扣模拟充值积分；退款按原分配批次退回，不会把快过期赠送积分转成永久充值积分。
  - 所有增减分统一写流水：演示赠送、签到、模拟充值、查证扣除、退回、到期。
  - 多组件共用同一个 store；监听 `storage` 事件同步其他标签页；SSR 返回固定 loading 快照，首帧不读 `window/localStorage`。
  - localStorage 损坏时备份原值并恢复演示初始状态；localStorage 不可写时退化为内存账本，页面显示明确提示，不白屏。
- 积分中心：
  - 总可用积分、`floor(余额 / 8)` 个疑点估算、赠送 / 模拟充值分栏、赠送批次与到期日。
  - 每日签到 +10，同一浏览器同一北京时间日期只能领取一次；首页账号面板与积分中心共用签到状态。
  - 三档套餐：9.9 元 / 100 积分、29.9 元 / 330 积分（多送 10%）、99 元 / 1200 积分（多送 20%），每档显示约可查疑点数。
  - 微信 / 支付宝仅作禁用占位；显示「支付即将开放 · 当前仅供演示」，不生成二维码、不出现「支付成功」。
  - 「模拟 +100」与「模拟到账」都写本地流水；按钮有 `event.detail > 1` 双击拦截与 800ms 同 tick 锁，同步双击只入账一次。
  - 最近积分流水展示最近 8 条；无记录时给空状态。
  - 样例报告复用 `cache/script-demo-1.json`：`/case?mode=demo&demoId=script-demo-1`。
  - 页脚「开始体检」接现有 `/?intake=scriptcheck`。
- 查证扣费闭环：
  - 免费拆疑点不扣积分；0 疑点 / 未勾选不扣费。
  - 文案体检 ⑦：确认 N 个疑点时预占 `N × pricePerClaim`，余额不足时按钮禁用并给 `/credits` 入口；预占成功后才写交接并跳 `/case`。
  - 文案体检 ⑦b：倒计时/立即开始/手动开始统一在 `begin` 里预占；交接失败退回预占。
  - 图片立案：核对疑点后预占 `N × pricePerClaim`，余额不足不发起深查；弹窗显示每个 / 合计 / 余额。
  - 消息查证：首页跳转前按自动模式上限预占 24 积分（3 个疑点 × 8），结案按 `billing` 退回差额；交接只读一次即删。
  - `/case` 消费 `billing` 事件，并把 `done.caseFile.billing` 作为兜底；同一交易 / 同一 `caseId` 只结算一次。
  - 最终净扣以 `billing.charged - billing.refunded` 为准，不根据判决文案猜退款；0 费用、部分退款、全额退款都走同一结算方法。
  - 终止失败、网络中断、流缺失、`done` 无 `billing` 时退回预占；可恢复 `error` 不触发退款。
  - 页面关闭 / 刷新遗留的 pending 交易，超过 10 分钟未结算时在下次加载自动退回。
  - mock / demo 回放不创建本地交易，卷宗页标注「演示不扣积分」。
- 卷宗页左栏新增积分结算卡：只读结构化 `billing` 字段生成「查证 N 个 · 扣除 X · 退回 Y · 净扣 Z」，不展示可能含「元」的 `billing.reason`。

### 改动文件

新增：

- `app/credits/page.tsx`
- `components/credits/credits-workspace.tsx`
- `components/credits/credits-top-bar.tsx`
- `components/credits/credits-balance-card.tsx`
- `components/credits/credits-packages.tsx`
- `components/credits/credits-checkout.tsx`
- `components/credits/credits-ledger.tsx`
- `components/credits/credits-footer.tsx`
- `lib/credits-policy.ts`
- `lib/credits-store.ts`
- `lib/credits-format.ts`
- `lib/credits-intake.ts`
- `lib/use-credits-center.ts`
- `public/images/detective-avatar.png`
- `screenshots/credits-desktop.png`
- `screenshots/credits-mobile.png`

修改：

- `lib/credits.ts`：从临时只读演示余额改为 localStorage 账本视图，保留 `useCredits` / `readCredits` 调用兼容。
- `components/home/account-dock.tsx`：余额 / 签到共用 store，「积分充值」跳 `/credits`。
- `components/home/home-input-card.tsx`：消息查证预占 24 积分并写版本化 sessionStorage 交接；余额不足给积分中心入口。
- `components/claims/claims-top-bar.tsx`：显示本地余额并链接积分中心。
- `components/claims/claims-pick.tsx`：展示余额、预计扣费与不足拦截。
- `components/claims/claims-autorun.tsx`：费用行改本地积分口径，余额不足给 `/credits` 入口。
- `lib/use-claims-check.ts`、`lib/use-claims-autorun.ts`、`lib/claims-intake.ts`：确认 / 自动开查前预占，交接携带 `transactionId`。
- `app/case/page.tsx`：读取积分交接、建立本地交易、消费 `billing` / `done`、失败退回、图片确认预占、重试重新预占。
- `components/case/claim-review-dialog.tsx`：图片立案显示积分合计、余额、不足拦截与预占失败提示。
- `components/progress-feed.tsx`：卷宗左栏显示积分模式与结算结果。
- `lib/claims-autorun-controller.ts`：默认积分状态补 message 字段。
- `lib/labels.ts`：新增积分流水类型中文映射。

未改动：`app/api/`、`lib/pipeline/`、`types/`、`mock/`、`cache/`、`scripts/`。

### 已验证

- `pnpm typecheck`：通过。
- `pnpm lint`：0 error（6 条既有 warning，均为 `<img>` 或旧脚本未使用变量）。
- `pnpm build`：通过，`/credits` 静态预渲染。
- store 逻辑脚本（临时文件，未提交）：
  - 初始 120；签到一次 +10，第二次返回 already；模拟充值 +100 独立成批。
  - 预占 24，`charged=24 / refunded=4` → 净扣 20、退回 4，余额从 230 → 210。
  - 同一交易重复结算 / `done` 重复到达只结算一次；全额退款净扣 0。
  - 余额不足返回 insufficient，余额不变成负数。
  - 过期赠送 30 先失效；再预占 40 时先扣赠送、再扣充值，余额正确。
  - 中断退回全部预占；迟到的 billing 不再扣；0 费用交易净扣 0；同一 `caseId` 第二笔预占自动退回。
- 真实接口端到端（浏览器 + 本地 dev server）：
  - 首页输入「隔夜水不能喝，放一晚会产生致癌物亚硝酸盐」→ 预占 24 → 结案 `charged=8 / refunded=0` → 退回 16，余额 120 → 112，卷宗左栏显示「查证 1 个疑点 · 扣除 8 积分 · 未产生退款 · 实际净扣 8 积分」。
- 浏览器：
  - `/credits` 桌面 1440×900 三栏无横向溢出，截图 `screenshots/credits-desktop.png`。
  - 390×844 移动视口通过 CDP 实测 `document.documentElement.scrollWidth = 390`，无越界元素，截图 `screenshots/credits-mobile.png`。
  - 签到后刷新仍为已领取；首页账号面板余额与签到状态同步；「积分充值」跳转 `/credits`。
  - 同步 dispatch 两次 click（detail=1 + detail=2）只入账一次；同一事件循环两次 detail=1 也只入账一次（800ms 锁）。
  - demo 卷宗 `script-demo-1` 回放前后余额 120 不变，页面显示「演示不扣积分」。
  - localStorage 写入 `{broken-json` 时显示「本地积分数据已损坏」并恢复 120；`Storage.prototype.setItem` 强制抛错时显示「浏览器存储不可用」，页面不白屏。

### 已知缺口

- 直接打开 `/case?mode=real&text=...`（没有首页积分交接）时，页面显示「未经首页积分预占 · 本次不扣本地积分」，仍会发起真实查证但不走本地扣费；这是为避免刷新 / 手改 URL 重复扣费的保守策略。完整覆盖需要 A 提供请求前疑点数或服务端幂等键。
- 本地积分是演示账本，不是生产钱包：没有登录、账户接口、真实订单、支付回调或支付 SDK。
- 模拟充值立即入账；没有订单号、支付状态或退款单，只写本地流水。
- 本地只做 UI / 交易层幂等，不等价于服务端幂等。

## 十、新侦探形象替换

- 角色依据用户提供的 `侦探2d.jpg`：肤色圆脸、棕色侦探帽、绿色帽带、金色单片镜与链条、红色小鼻子、绿色风衣、大眼睛。
- `public/images/detective-logo.png`：完整半身，512×512 透明 PNG，已确认 `hasAlpha: yes`，无白底。
- 新增 `public/images/detective-avatar.png`：从同一张透明位图裁出头部 + 帽檐 + 单片镜链条，512×512 透明，用于 24–48px 小尺寸；不拉伸、不裁掉帽子 / 单片镜 / 眼睛 / 红鼻子。
- `DetectiveMascot` 新增可选 `variant="full" | "avatar"`，默认 `full`，对外 className / style / mood 兼容；`mood="yawn"` 使用同一新角色静图并叠加 Zzz，不回退旧绿脸。
- 小尺寸调用处已切头像：账号悬浮球 / 账号面板、文案体检顶栏、进度头像、案例页头、疑点选择栏、自动开查提示、图片疑点确认弹窗。
- 大尺寸继续用完整半身：首页报案单、空状态、失败弹窗、证据图谱空态、styleguide。
- 全项目检索 `detective-logo.png` / `DetectiveMascot` / 旧 SVG，未发现旧绿脸手绘残留；没有替换合作方 logo、元宝搜索标识或产品名。
- 截图：`screenshots/credits-desktop.png`、`screenshots/credits-mobile.png`；styleguide 第 07 节同时展示完整半身与头像裁切。

## 十一、需 A 配合（积分口径与接口）

1. **billing 单位**：`lib/pipeline/index.ts` 的 `PRICE_PER_CLAIM` / `REFUND_PER_CLAIM` 注释与 `billing.reason` 仍写「元」，`lib/export-md.ts` 的结算行也写「元」。前端已统一使用「积分」，并且不直接展示 `billing.reason`；建议 A 把后端注释、reason 与 Markdown 导出统一改成「积分」。
2. **没有积分账户 / 订单 / 支付接口**：本次没有新增或伪造余额查询、充值、订单、支付回调接口；`/credits` 只是本地演示。若后续做真实钱包，需要 A 定义账户余额、扣费 / 退款、订单与幂等接口。
3. **消息查证请求前不知道疑点数**：前端按 `AUTO_CLAIM_LIMIT = 3` 预占 24 积分，结案按 billing 退回差额。若 A 调整 `lib/pipeline/index.ts` 的自动模式上限或单价，请同步通知前端更新 `lib/credits-policy.ts`；更理想的是复用 `extract-claims` 预览或提供请求前计数接口，前端才能按实际 N 预占。
4. **直接 URL 入口**：`/case?mode=real&text=...` 无首页交接时不会本地扣费（仅展示提示）。如果要求所有入口都关闭扣费，建议 A 提供服务端幂等键（`previewId + selectedClaimIds` 或交易 id），前端再把直接 URL 也纳入预占。
5. **服务端结算幂等**：本地按交易 id + `caseId` 去重；真实钱包仍建议服务端按 `previewId + selectedClaimIds` 或客户端交易 id 幂等，避免 SSE 重连 / 重试造成重复扣费。
6. **流缺失 / done 无 billing**：前端在终止失败或结案无 billing 时退回预占，优先避免重复扣费；真实钱包需要 A 明确「服务端已扣但事件丢失」的对账 / 回滚策略。

## 十二、办案会话跨页：回到首页不再卡「正在立案」

### 背景

从办案页点顶部「首页」返回后，首页会因路由缓存保留上一次提交时的 `submitting` 状态，底部按钮一直停在禁用的「正在立案…」；而办案页被隐藏时事件流会被卸载清理掉，导致返回后进度其实已经中断。

### 本次改动

- 调查状态从组件内 `useReducer` 提升为模块级单例（`lib/use-investigation.ts`），用 `useSyncExternalStore` 订阅；办案页被路由缓存隐藏时事件流继续跑，重新可见直接复用当前进度。
- 新增真实查证的「办案会话」登记（`ActiveCaseSession`）：记录办案页地址、原始消息、立案方式与终止收尾回调；结案 / 失败 / 主动停止后自动清空。
- 首页（`components/home/home-input-card.tsx`）在办案会话存在时，把原来的禁用按钮替换为：
  - 绿色「⏳ 正在立案… · 回到办案页 →」，点击直接回到正在运行的 `/case`；
  - 「终止办案」按钮，二次确认后中止事件流并退回本案预占积分。
- 办案页顶部绿栏（`components/case/case-header.tsx`）在 running 时也显示「■ 终止办案」：点击后就地展开「终止后积分退回 / 取消 / 确认终止」；终止后顶部状态变为「■ 已终止」，并出现红色提示条与「返回首页重新立案 →」。
- 首页被隐藏再返回时会清掉遗留的 `submitting` / 终止确认状态，避免再次卡在加载态。
- 办案页（`app/case/page.tsx`）在路由重新可见时按 `isCaseSessionBlocked(href)` 判断，已有会话或刚被终止就不重复开同一案，避免重复请求与重复扣费；再次从首页 / 文案体检立项前用 `resetCaseSession()` 清掉终止标记。
- 文案体检两处跳转 `/case?flow=scriptcheck`（`lib/use-claims-check.ts`、`lib/use-claims-autorun.ts`）同样先清会话标记。

### 改动文件

- `lib/use-investigation.ts`
- `app/case/page.tsx`
- `components/case/case-header.tsx`
- `components/home/home-input-card.tsx`
- `lib/use-claims-check.ts`
- `lib/use-claims-autorun.ts`

### 已验证

- `pnpm typecheck`、`pnpm lint`（0 error）、`pnpm build` 均通过。
- 浏览器实测（真实接口）：首页提交消息 → 办案页 → 点「首页」→ 首页显示可点击的「正在立案…」与「终止办案」→ 点击入口回到同一卷宗且进度继续 → 点「终止办案」出现二次确认 → 确认后首页恢复「立案调查」按钮。
- 浏览器实测（真实接口）：办案页 running 时顶部出现「终止办案」→ 确认后顶部变「已终止」、出现红色提示条与「返回首页重新立案 →」→ 返回首页恢复普通「立案调查」按钮。
- 终止时通过会话里的 `onTerminate` 退回预占积分；结算交易已是 settled 时 `releaseCredits` 幂等，不会重复退款。

### 已知缺口

- 办案页被路由缓存彻底淘汰（超过 3 条路由）后再返回，会按当前 URL 重新开案；真实钱包仍需服务端幂等键兜底。
- 案件在首页停留期间结案时，本地积分结算要等回到办案页的结算 effect 才会落账；超时会由积分 store 的 10 分钟 pending 自动退回兜底。

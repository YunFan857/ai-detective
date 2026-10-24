# 后端细则（A）

- 流水线每阶段一个文件，放在 `lib/pipeline/`。
- 所有 emit 的事件必须通过 `CaseEventSchema`（zod）校验。
- 错误优先降级：单路搜索或单次模型失败不得抛到前端，转为可展示的降级事件。

## 来源数据约定

- `site` 缺失时用 URL 域名（去掉 `www.`）兜底；标题、摘要统一折叠空白。
- `snippet` 入库前截断到 200 字（含省略号），避免超长正文撑破卡片与提示词。
- `publishedAtStatus`：搜索返回或补抓成功为 `known`；尝试后仍无时间为 `missing`，前端据此显示“时间不详”。

## 同源组约定

- 只有合并了至少两条来源才生成 `SourceGroup`；无关来源与独立信源不建组、不带 `groupId`。
- 建组的来源必须在 `sources` 对象与 `source_update` 事件里同时写入 `groupId` / `isOrigin`。
- `countIndependent` = 相关来源数 − 被折叠进同源组的转载数。

## 信息性事件

- `claim_progress` 与 `billing` 是给前端的进度/结算信息，前端可忽略，不影响卷宗字段。

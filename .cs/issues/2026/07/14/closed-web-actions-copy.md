---
kind: issue
title: "Web 动作栏与文案收敛"
type: feature
status: closed
created: 2026-07-14
epic: ".cs/epics/2026/07/14/vendor-web-productization/spec.md"
---

# Web 动作栏与文案收敛

## 质量目标

- **交互能力（易操作、用户差错防御）**：本地技术用户能区分“改 draft”与“写入 models.json”；每个破坏性或终止动作明确对象、后果和取消路径。证据：agent-browser 走查 dirty/clean header、model editor、Raw JSON、import、secret/delete/overwrite confirm。
- **信息安全性（保密性）**：文案将已配置 secret 说明为受保护值，不展示或暗示可恢复原值；危及 secret 删除时明确后果。证据：现有 SecretRef 行为不变，浏览器走查不出现明文或 `opaque`/`SecretRef` 内部术语。

## 现状如何工作

Web 只有一个浏览器内 draft，最终 `Save & close` 才经 revision/validation 写入 `models.json`。但目前顶栏的 clean 状态写作 “All changes saved”，把“draft 尚未改变”误表述为已经保存；`Cancel` 不能说明它会关闭整个临时 session。模型 editor、Raw JSON、import 都只是在更新 draft，却分别使用 Save/Apply/Add 等近似终态的文案。通用 prompt 仍有 “OK”，一些 secret JSON hint 泄露 `SecretRef`/opaque 内部术语。

## 影响范围

- 必须修改：`packages/pi-vendor/src/web/client/provider-view.ts`、`models/model-view.ts`、`raw-view.ts`、`preview.ts`、`app.ts`
- 需要验证：dirty/clean command bar、add/edit/import/raw/preview、所有确认动作、secret 文案；agent-browser + vendor tests/typecheck/build
- 不触及：Config core、SecretRef hydration、mutation 语义、HTTP API、视觉基础 tokens

## 方案判断

不新增状态机或 toast 框架。复用现有 `dirty`、dialog 与 reducer：让文案反映真实生命周期，并把 confirm/prompt 的动词和安全退出文字参数化。最终写入只称 **Save & close**；其余操作统一明确为 **… to draft** 或 **Apply JSON to draft**。

## UI 规格（目标）

用户从 Pi 打开一次性本地 manager；以下结构是目标约束，文案细节可按现有窄屏布局换行：

```text
clean draft
┌ Pi Vendor ────────────────────────────────────────────┐
│ No changes                                      [Close] │
└────────────────────────────────────────────────────────┘

dirty draft
┌ Pi Vendor ─────────────────────────────────────────────────────────┐
│ Unsaved changes   [Discard & close] [Review changes] [Save & close] │
└─────────────────────────────────────────────────────────────────────┘

scoped draft editors
Raw JSON:       [Discard JSON edits] [Apply JSON to draft]
Model editor:   [Discard model edits] [Add/Update draft]
Import dialog:  [Close import] [Replace N in draft] [Add N to draft]
```

- `Close` 在 clean draft 时结束临时 session，配置不变。
- `Discard & close` 在 dirty draft 时必须二次确认；取消动词为 “Keep editing”。
- `Review changes` 是只读检查，不写入且不作为主动作。
- 敏感/破坏性 confirm 必须说明具体对象和后果，取消按钮表明保留什么。

## 实现设计

1. **顶栏**（`provider-view.ts`）：依据 `state.dirty` 渲染两种操作集。dirty 只保留一个 primary `Save & close`；clean 仅渲染 `Close`。状态文字为 `Unsaved changes` / `No changes`，不声称已写盘。
2. **作用域动作**：Raw、editor、import 的提交动作增加 `to draft`；关闭 editor/raw/import 的动作明确丢弃的是何种未应用内容。import 根据 ready count 写入数量，ready=0 时禁用 mutation actions。
3. **通用 dialogs**（`provider-view.ts`）：`showPromptDialog` 接收 confirm label；`showConfirmDialog` 接收 cancel label（默认 `Keep editing`）。所有 caller 使用对象化标题、确认动词和保留对象的取消文字，危险操作保留现有二次确认与 safe-first cancel focus。
4. **恢复文案**：状态、validation、catalog/import 和 secret 文字说出下一步，不出现 `opaque`、`SecretRef` 或 `pi-vendor-secret:*`。JSON 解析错误提示有效 JSON 及最短修正方向。
5. **边界**：不改 reducer/API/secret 实现；只改 UI 文案和 disabled presentation。`Save & close` 仍走原 revision/validation/atomic commit，scoped actions仍只改 draft。

## 验证

- agent-browser：
  - clean header 只有 Close；编辑一个字段后为 Unsaved changes + Discard & close / Review changes / Save & close
  - editor / raw / import action labels 均含 draft 语义，import zero-ready mutation actions disabled
  - delete/overwrite/secret/discard confirm 的确认与取消文案包含具体对象/后果
  - configured secret 不泄露明文或内部实现术语
- `npm --workspace @bytetrue/pi-vendor test`、typecheck、build:web、Impeccable detector

## 执行记录

- 顶栏基于 draft 状态切换：clean = `No changes` + `Close`；dirty = `Unsaved changes` + `Discard & close` / `Review changes` / `Save & close`。
- scoped actions 统一说明写入范围：Raw `Apply JSON to draft`，editor `Add to draft` / `Update draft`，import `Add/Replace N in draft`；import 0-ready 时禁用动作。
- confirm/prompt 支持具体确认与取消标签；delete/replace/secret/discard 均说明对象、何时实际写盘、保留路径。
- Secret 文案移除 opaque/SecretRef 内部术语；Raw / Preview 不展示明文，直接提示配置值受保护。
- 官方模板/catalog/import/loading/JSON errors 改为“发生什么 + 下一步”的短文案；未改 Config core、SecretRef 或提交语义。

## 验证

- agent-browser：clean header、dirty header、Review、Raw invalid JSON、Add model editor、discard confirm、Import 0-ready disabled、model delete confirm；浏览器 console/errors 为空。
- `npm --workspace @bytetrue/pi-vendor test` — 296 passed；覆盖 raw JSON recovery 文案与 secret deletion timing。
- `npm --workspace @bytetrue/pi-vendor run typecheck`、`build:web` 通过；Impeccable detector `[]`。

## 关闭回写

- epic：稳定 action vocabulary 与 single-terminal-action rule
- project spec：仅随 epic 关闭毕业

## 关闭结论

- **关闭判断**：owner 已确认。clean/dirty draft、scope actions、danger confirms 与 secret recovery copy 均按 UI 规格实现，未改变写盘、revision 或 SecretRef 安全语义。
- **质量证据**：交互能力由 agent-browser 实测 clean/dirty header、Review、Raw invalid JSON、editor、import 0-ready、delete/discard confirms（console/errors 为空）支撑；信息安全性由用户文案不出现 `opaque`/`SecretRef` 内部术语、继续 opaque secret handling 与 296 测试支撑。
- **回写位置**：`.cs/epics/2026/07/14/vendor-web-productization/spec.md` 的当前方案、issue 列表与关闭候选。
- **遗留**：无本 issue 遗留。Epic 本身仍为 draft，需 owner 明确决定是否关闭并毕业到 project spec。

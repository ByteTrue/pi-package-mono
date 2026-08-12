---
doc_type: refactor-design
refactor: 2026-07-11-vendor-command-split
status: approved
scope: packages/pi-vendor/src/command.ts 拆为 model-list / vendor-ui / models-menu / provider-menu + 薄 command
summary: 组合包 B：#1–#4 行为等价拆分；#5 不单开
---

# vendor-command-split refactor design

## 1. 本次范围

- **做**：scan #1 #2 #3 #4（用户选 B）
- **不做**：#5 单独立项（`cloneJson` 若 #1 需要可内联共用，不另开步）
- **行为等价**：`/vendor` 菜单文案、交互路径、确认对话框、`models.json` 读写语义不变；不改 public export 形状（`registerVendorCommand` / default 仍从 command 或 index 同路径 re-export）
- **工作量**：约 4 步；风险：步骤 1–2 低，步骤 3–4 中（HUMAN）

## 2. 前置依赖

1. **刻画测试（步骤 1 内）**：为 `modelList` / `upsertModel` / `removeModelAtIndex` / `replaceModelAtIndex` 补 `model-list.test.ts`（或并入 `models-json.test.ts`）
2. **调用方**：仅 `command.ts` 内部 + `index.ts` re-export `registerVendorCommand` — 无跨包依赖 command 内部 helper
3. **不改** `custom-select.ts` 实现，只搬包装层

## 3. 执行顺序

### 步骤 1：抽出 model 列表纯函数 + 补测

- **引用方法**：M-L2-04 Move Function + M-L1-04 Characterization Test
- **操作**：
  1. 新建 `packages/pi-vendor/src/model-list.ts`，移入 `modelList` / `upsertModel` / `removeModelAtIndex` / `replaceModelAtIndex`（及局部 `cloneJson` 或从 models-json 复用若已有）
  2. 写 `model-list.test.ts`：空 models、upsert 新/覆盖、remove、replace 同 id
  3. `command.ts` 改为 import 这些函数
- **退出信号**：`npm --workspace @bytetrue/pi-vendor test` 全绿；`command.ts` 无本地 upsertModel 定义（grep）
- **验证责任**：AI 自证
- **回滚**：删 `model-list*`，还原 command 内函数

### 步骤 2：抽出 UI 壳到 vendor-ui.ts

- **引用方法**：M-L2-04 Move Function
- **操作**：
  1. 新建 `vendor-ui.ts`：`VENDOR_OVERLAY_OPTIONS`、`customSelect`、`selectValue`、`customInput`、`promptInput`、`promptJsonObject`、预览 helpers（若仅 command 用可留到菜单文件）
  2. `command.ts` 及后续 menu 文件 import 自 `vendor-ui.ts`
- **退出信号**：typecheck + vendor test 绿；无重复 `createCustomSelect` 包装
- **验证责任**：AI 自证
- **回滚**：删 vendor-ui，函数挪回 command

### 步骤 3：models 菜单 → models-menu.ts

- **引用方法**：M-L3-07 Single Responsibility Split + M-L2-04
- **操作**：
  1. 新建 `models-menu.ts`：`addEnrichedModel` / `addManualModel` / `importFromOpenAIModels` / `editModelJson` / `removeModel` / `manageModels` + 相关 label/menu 常量
  2. `command` / `provider-menu` 仅调用 `manageModels(ctx, draft)`
- **退出信号**：test + typecheck 绿；HUMAN 过一遍模型管理
- **验证责任**：**HUMAN** — `/vendor` → Manage models：Add（搜索/custom）、Import（若有 baseUrl）、Edit JSON、Remove、Back
- **回滚**：git revert 本步

### 步骤 4：provider 菜单 → provider-menu.ts，command 变薄

- **引用方法**：M-L3-07 + M-L2-04
- **操作**：
  1. 新建 `provider-menu.ts`：`PROVIDER_MENU`、`editProviderKey`、`editProviderDraft`、`pickProvider`、`chooseProviderDraft`、providerLabel 等
  2. `command.ts` 只保留 `registerVendorCommand`（读 json → choose → edit → confirm rename/overwrite → upsert/write）与 default export
  3. 目标：`command.ts` ≲ 100 行量级
- **退出信号**：test + typecheck；HUMAN 过 provider 编辑与保存
- **验证责任**：**HUMAN** — 选 provider、改 name/baseUrl/apiKey、Save、Cancel、Rename 确认
- **回滚**：git revert 本步

## 4. 风险与看点

| 风险 | 缓解 |
|---|---|
| 搬移时漏改 import 导致 runtime 找不到 | typecheck + 全量 test |
| models/provider 菜单循环依赖 | 单向：command → menus → ui/model-list；menus 互不 import |
| HUMAN 漏测 cancel/escape | 步骤 3/4 清单显式写 Cancel/Back |
| 误改文案或 confirm 文案 | 只 move，不改字符串常量内容 |

## 5. 目标文件布局

```
packages/pi-vendor/src/
  model-list.ts (+ test)
  vendor-ui.ts
  models-menu.ts
  provider-menu.ts
  command.ts          # 薄：registerVendorCommand only
  ...existing...
```

## 用户确认

请整体 review 本 design。同意后回复 **approved** / **放行**，再进入 apply（checklist 已并附）。

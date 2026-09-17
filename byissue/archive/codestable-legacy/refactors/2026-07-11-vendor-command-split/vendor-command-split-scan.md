---
doc_type: refactor-scan
refactor: 2026-07-11-vendor-command-split
status: user-reviewed
scope: packages/pi-vendor/src/command.ts（595 行）及同包已有纯模块边界
summary: 结构 4 / 可读性 1；低风险 3 / 中 2；建议先做 #1+#2
source_audit: .codestable/audits/2026-07-11-packages-scan/finding-05.md
---

# vendor-command-split scan

## 总览

- 扫描范围：`packages/pi-vendor/src/command.ts`（595 行）；对照已拆的 `models-json.ts` / `openai-models.ts` / `custom-select.ts` / `enrich.ts`
- 发现 **5** 条优化点：结构 4 / 可读性 1
- 按风险：低 3 / 中 2 / 高 0
- 建议先做：**#1 #2**（纯数据与 UI 壳拆分，AI 可 typecheck + 现有单测自证）
- 建议后做：**#3 #4**（大交互循环搬文件，无 command 级单测，需 HUMAN 点一遍 `/vendor`）
- 可选：**#5**（cloneJson 去重，收益小）
- **前置检查**：1 无行为改动 ✓ · **2 测试：部分命中**（见下）· 3 非跨模块 ✓ · 4 非风格 ✓ · 5 非生成物 ✓ · 6 范围 1 文件 ✓ · 7 有可验证项 ✓

### 前置检查 2（测试）说明

`command.ts` **没有** `command.test.ts`；核心是 TUI 状态机，难自动测。  
同包纯逻辑（`models-json` / `openai-models` / `enrich` / `fuzzy`）有测。  

因此：
- 可安全做的是 **搬移 + 导出纯函数并补 1–2 个 characterization 单测**（#1）
- 整文件拆分（#3/#4）验证标 **HUMAN**（交互点 `/vendor` 保存/取消/改 key）
- 不建议在无任何自证下硬拆 500+ 行 UI

## 条目

### [1] 抽出 model 列表纯函数到 models-menu 或 models-json ✓
- **位置**：`packages/pi-vendor/src/command.ts:47-84`
- **分类**：结构
- **现状**：`cloneJson` / `modelList` / `upsertModel` / `removeModelAtIndex` / `replaceModelAtIndex` 与 TUI 混在一起
- **问题**：纯数据变换埋在 595 行 UI 文件；无单测；`models-json.ts` 已是 provider 数据层
- **建议**：搬到 `model-list.ts`（或并入 `models-json.ts`），补 2–3 个 unit 测 upsert/remove/replace
- **建议映射的方法**：M-L2-04 Move Function + M-L1-04 Characterization Test
- **风险**：低 — 纯函数、无 IO
- **验证**：AI 自证 `npm --workspace @bytetrue/pi-vendor test` + 新单测
- **范围**：约 40 行 / 2 文件

### [2] 抽出 UI 壳（customSelect/customInput/prompt*）到 vendor-ui.ts ✓
- **位置**：`packages/pi-vendor/src/command.ts:95-155`
- **分类**：结构
- **现状**：overlay 选项与 `createCustomSelect`/`createCustomInput` 包装堆在 command
- **问题**：每个菜单函数重复依赖同一壳；`custom-select.ts` 已是组件实现，缺 command 层薄封装文件
- **建议**：`vendor-ui.ts` 导出 `customSelect` / `customInput` / `promptInput` / `promptJsonObject` / `selectValue` / overlay 常量
- **建议映射的方法**：M-L2-04 Move Function
- **风险**：低 — 签名不变的搬移
- **验证**：AI 自证 typecheck + 现有 custom-select 测；HUMAN 可选点一次菜单
- **范围**：约 70 行 / 2 文件

### [3] 抽出 manageModels 流到 models-menu.ts ✓
- **位置**：`packages/pi-vendor/src/command.ts:164-399`（含 addManualModel 73 行、manageModels 75 行）
- **分类**：结构
- **现状**：加模型 / 导入 /models / 编辑 JSON / 删除全在 command
- **问题**：单文件职责「注册命令 + 选 provider + 编 provider + 管 models」；最长交互块难 diff
- **建议**：`models-menu.ts` 导出 `manageModels(ctx, draft)` 及内部 helpers
- **建议映射的方法**：M-L3-07 Single Responsibility Split + M-L2-04
- **风险**：中 — 无 command 级测；漏 cancel/back 只能人点
- **验证**：HUMAN：Add model / Import / Edit JSON / Remove / Back；AI：typecheck + 全量 vendor test
- **范围**：约 230 行 / 2 文件

### [4] 抽出 editProviderDraft + chooseProvider 到 provider-menu.ts ✓
- **位置**：`packages/pi-vendor/src/command.ts:400-515` + `registerVendorCommand` 保存环 517-591
- **分类**：结构
- **现状**：provider 字段编辑巨型 if 链 + 选择/新建 draft 与 save 确认同文件
- **问题**：与 models 菜单同级职责未分界；`registerVendorCommand` 仍可只做「读→选→编→写」编排
- **建议**：`provider-menu.ts` 导出 `chooseProviderDraft` / `editProviderDraft`；`command.ts` 仅 `registerVendorCommand` + 保存
- **建议映射的方法**：M-L3-07 + M-L2-04
- **风险**：中 — 保存确认/rename/overwrite 分支多，需 HUMAN
- **验证**：HUMAN：Edit key/name/baseUrl/apiKey、Save、Cancel、Rename confirm；AI：typecheck + test
- **范围**：约 200 行 / 2 文件

### [5] 去掉重复 cloneJson（command 与 models-json 各一份） ✗ 不在 B 包（cloneJson 随 #1 顺带即可，不单开）
- **位置**：`command.ts:47-49` 与 `models-json.ts` / `official-catalog.ts` 同类实现
- **分类**：可读性
- **现状**：JSON 深拷贝本地复制
- **问题**：三处同构 3 行；非功能问题
- **建议**：若做 #1，统一从一处 export `cloneJson`；否则可 ✗ 跳过
- **建议映射的方法**：M-L2-04
- **风险**：低
- **验证**：AI 自证现有 models-json 测
- **范围**：约 10 行 / 2–3 文件

## 建议组合包

| 包 | 条目 | 说明 |
|---|---|---|
| **A 最小** | #1 ✓ #5 ✓ | 纯数据 + 去重，可测，command 仍长但数据层清 |
| **B 推荐** | #1 #2 #3 #4 | 完整拆成 ui / models-menu / provider-menu / command 薄入口 |
| **C 仅结构壳** | #2 #3 #4 | 不碰数据函数（不推荐，#1 最便宜） |

**行为等价承诺**：不改 `/vendor` 菜单文案、确认流、写入 `models.json` 语义；只搬文件/函数。

请在各条标题行末标 **✓** 或 **✗（理由）**，或直接回：`A` / `B` / `C` / 自定义编号。


## 用户选择

- 组合包 **B**：#1 #2 #3 #4 ✓；#5 不单开（可随 #1 内联去重）

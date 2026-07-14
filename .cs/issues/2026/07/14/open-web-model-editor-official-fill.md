---
kind: issue
title: "Web 模型编辑器：按 id 官方填充"
type: feature
status: open
created: 2026-07-14
epic: ".cs/epics/2026/07/14/vendor-web-productization/spec.md"
---

# Web 模型编辑器：按 id 官方填充

## 目标

在 Add/Edit Model 对话框内，用户能按 model id 搜索/选择官方 catalog 或触发 enrich，将模板字段写入编辑器；编辑已有模型时「从官方填充」需二次确认；headers/密钥字段不覆盖。

## 范围

- 包含：编辑器内 catalog/enrich 入口、歧义选择、加载/错误态、与已确认填充策略一致；**补上 session 未接线的 catalog/enrich（及同批 discover 若零成本）handler**
- 不包含：完整表单字段补齐、布局大改、TUI 改动、旁路 Official Catalog 区块的视觉重做（可保留，但本 issue 不以它为主路径）

## 归属

- 隶属 epic：`.cs/epics/2026/07/14/vendor-web-productization/spec.md`
- 相关 spec：`.cs/spec/pi-vendor/index.md`

## 背景与证据

- talk：`.cs/talks/2026-07-14-vendor-web-productization.md`
- 对照 TUI：`packages/pi-vendor/src/tui/quick-add-model.ts`（catalog 搜 → 选 → 无结果 enrich）
- Web 客户端：`web/client/models/state.ts`、`model-view.ts`、`app.ts`
- 服务端路由壳：`web/server/server.ts`（`handleCatalog` / `handleEnrich` 可选）
- 会话：**`web/server/session.ts` 创建 server 时未传入上述 handlers** → 客户端 `catalogAvailable: true` 但 API 实际不可用
- Core：`searchOfficialModels`、`enrichModelForWeb`、`toWebModelConfig`（`WebModelConfig` **不含 headers**）

## 待确认问题

- 无阻塞。cost 是否展示留给 form-fields issue。
- 文案可用中英简洁默认（如 “Fill from official” / “Searching…”），实现时可微调。

## 现状如何工作

一句话：**官方 catalog/enrich 在 Node 与 HTTP 路由壳上已有，import 批处理会调 enrich；但会话没接线，编辑器也不提供“按 id 填充”，用户只能手填薄字段。**

主路径：

1. `/vendor web` → `runWebSession` → `createVendorWebServer` + 浏览器 draft。
2. `GET /api/state` 返回 draft、secretSlots、`catalogAvailable: true`、`modelFields`。
3. 打开 Edit/Add → `model-open-editor` → 对话框字段：id/name/api/reasoning/context/maxTokens/headers JSON。
4. Models 区底部 `renderCatalogSearch` 可调 `fetchCatalog`，选中后 `onOpenEditor(null, model)`——**旁路**，且依赖会话 handler。
5. Import tray 用 `fetchEnrich` / 歧义候选——同样依赖 handler。
6. TUI 加模型：`searchOfficialModels` → 有结果则选；无结果 `enrichModelForTui`（官方命中恒为需确认的 candidates；模板/默认则 ready）。

关键状态：编辑器 `editor.value` 仅内存 draft 片段；Save 进 document 仍走既有 `model-add` / `model-replace`，本 issue 不改写盘语义。

## 影响范围

- **必须修改**
  - `web/server/session.ts`：注入 `handleCatalog` / `handleEnrich`（建议同批 `handleDiscover`，否则 Import 仍是死按钮）
  - `web/client/models/state.ts`：纯合并函数 + 可选 reducer action；复用 `fetchCatalog` / `fetchEnrich`
  - `web/client/models/model-view.ts`：编辑器内填充 UI 与事件
  - `web/client/app.ts`：回调接线；处理 loading/歧义不丢 editor
  - 对应 vitest
- **需要验证**
  - import 路径 enrich 在 handler 接上后仍 work
  - SecretRef：填充不得写入/移动 headers 上的 ref
  - 未打开写盘：只改 editor / 再 Save 才进 draft
- **仍待调查**
  - 无（实现时若 catalog 加载失败，用既有错误码文案）

## 方案判断

- **根因不是“没 API”**，是 **session 未接线 + 编辑器未消费**。
- 复用 model-source 与现有 client API 形状，不在浏览器复制 catalog 逻辑。
- 合并规则做成**纯函数**，方便单测，不引入新包/框架。

## 实现设计

### 这次要怎么做

让「在编辑器里输入/确认一个官方模型 id，得到可编辑的模板字段」成为一条闭环：会话真正提供 catalog/enrich；编辑器提供搜索与填充；合并时永不碰 headers；编辑已有模型时二次确认。旁路 catalog 区块可暂时保留，本 issue 验收以**编辑器内路径**为准。

### 功能怎么分工

1. **会话接线（Node）**  
   在创建 server 时传入：
   - `handleCatalog(q, limit)` → `searchOfficialModels`，结果已是 closed choice 形状则原样/映射为 `CatalogEntry`
   - `handleEnrich({ modelId })` → `enrichModelForWeb`，返回 `WebModelEnrichmentResult`（`ready` | `official-candidates`）
   - 建议：`handleDiscover` → 现有 `discoverModelIds` + 会话内 credential 解析约定（与 design 中 discover 边界一致）；若 discover 接线超出本 issue 安全范围则单列，但 **catalog+enrich 必须本 issue 完成**

2. **模板合并（纯函数，client models state）**  
   例如 `applyOfficialTemplate(current, official, options)`：
   - `official` 仅接受 closed `WebModelConfig` / `ProviderModelConfig` 投影
   - **写入白名单**：`id, name, api, reasoning, thinkingLevelMap, input, cost, contextWindow, maxTokens, compat`（与 `MODEL_ALLOWED` 对齐）
   - **永不写入**：`headers` 及任何非白名单键
   - `options.mode`：
     - `replace-template-fields`：白名单字段整表用官方值覆盖（缺省官方字段则删除当前对应键，避免残留旧 api）——用于新增默认与「确认后的编辑填充」
   - 返回新 `value`，不碰 `secretSlots`

3. **编辑器 UI（model-view）**  
   在 dialog 顶部（ID 旁或 ID 下）增加：
   - 查询框默认绑定当前 `editor-id`（可同步）
   - 主按钮：**Fill from official**（或中文等价）
   - 区域：loading / error / 结果列表（catalog 多条或 enrich candidates）
   - 编辑模式（`editor.handle != null`）在真正写入前 `showConfirmDialog`：说明将覆盖模板字段、保留 headers

4. **编排（app / bindModelEvents）**  
   对齐 TUI 顺序（可观察行为一致即可）：
   1. 取 trim 后的 query/id，空则本地错误提示
   2. `fetchCatalog(query, 25|50)`  
      - 有结果 → 列表展示 `provider/modelId/name`，点选 →（若编辑则确认）→ `applyOfficialTemplate` → `model-update` 整表或逐字段/`model-apply-template` action  
      - 无结果 → `fetchEnrich(id)`  
        - `ready` → 确认策略后应用；若 `warning` 显示一行提示（default/template）  
        - `official-candidates` → 列表点选后应用（**禁止自动选第一条**）  
   3. 请求使用 AbortSignal；关编辑器或再次搜索时 abort 上一次  
   4. 填充只改 `editor.value`；用户仍按 Save 走 add/replace

### 请求 / 数据怎么走

```text
[Editor UI] id/query
    → GET /api/catalog?q&limit     → searchOfficialModels → entries[]
    → (empty) POST /api/enrich     → enrichModelForWeb
         ready → WebModelConfig
         official-candidates → OfficialModelChoice[]
    → applyOfficialTemplate(editor.value, closedModel)
    → editor.value'  (headers 保持)
    → 用户 Save → model-add / model-replace → draft（既有）
```

### 哪些边界不碰

- 不改 SecretRef / revision / commit / loopback 安全模型
- 不把 raw catalog 对象 spread 进 editor（只用 closed DTO / allowlist）
- 不在 enrich 时执行 command 或解析用户密钥到浏览器
- 不自动覆盖已有模型到 draft 文档（只填编辑器）
- 不做完整字段表单（compat 细控件等属下一 issue）；白名单字段可先进入 `value` 供后续表单展示 / Raw 可见
- 不删除旁路 catalog 区块（可选后续 issue 收敛）

### 设计侧重点

- **易用性**：填充入口在编辑器内，不靠页底旁路；歧义必须点选
- **安全性**：headers/密钥不覆盖；closed DTO；API 仍走 bearer + 既有错误码
- **可测试性**：`applyOfficialTemplate` 纯函数单测；session handler 可用现有 session 测试风格挂上 mock catalog
- **可维护性**：逻辑归属 models state + session 接线，不复制 enrich 规则到 view 字符串拼装之外

### 一步步怎么改

1. Session：接线 `handleCatalog` / `handleEnrich`（+ 可行则 `handleDiscover`）；补测试证明 `/api/catalog`、`/api/enrich` 200  
2. 纯函数 `applyOfficialTemplate` + 单测（保留 headers、白名单覆盖、编辑确认由 UI 层测/回调测）  
3. Editor UI + 异步编排 + abort  
4. `build:web` 更新 assets；手测 `/vendor web`：已知 id、歧义、无匹配 default、编辑保留 headers  
5. 回归 models state 既有测试

### 怎么确认做对

| 行为 | 预期 |
|---|---|
| 新增 + 已知官方 id Fill | 模板字段填入；可再改；Save 后进 draft |
| 多 candidate | 列表可选；不自动选第一项 |
| catalog 无命中 + enrich default | 有 warning；至少 id 与默认字段 |
| 编辑已有 + Fill | 确认框；确认后模板字段变；headers 原样 |
| 取消确认 | editor 不变 |
| 未接线回归 | 无 handler 时不再假装可用：若未接 discover 则按钮应失败可见；catalog/enrich 本 issue 必须接上 |
| 单测 | headers 保留；非白名单不进入 |

## 验证

- vitest：template merge + session/API 接线相关  
- 手动：`/vendor web` 编辑器内完成上表路径  
- `npm --workspace @bytetrue/pi-vendor test` 与 `build:web`  

## 执行记录

- （未开始；设计已写）

## 关闭回写

- epic / project spec：（关闭时填）

## 关闭结论

- （关闭时填）

---
kind: issue
title: "Web Add model 主路径对齐 TUI"
type: feature
status: open
created: 2026-07-14
epic: ".cs/epics/2026/07/14/vendor-web-productization/spec.md"
---

# Web Add model 主路径对齐 TUI

## 目标

Add model 默认进入与 TUI 一致的三源路径（catalog 搜 id / custom / import），而不是空白表单为唯一入口；Import 必须真正可调用 `/api/discover`。

## 范围

- 包含：Add model 源选择、与已有官方填充/编辑器衔接、import 入口可达、**session 接线 `handleDiscover`**
- 不包含：import tray 大重构、视觉 redesign、TUI 改动

## 归属

- 隶属 epic：`.cs/epics/2026/07/14/vendor-web-productization/spec.md`
- 相关：`closed-web-model-editor-official-fill`、`closed-web-visual-redesign`

## 背景与证据

- TUI：`quick-add-model.ts` 三源 choose → catalog/custom/import
- Web：`btn-add-model` 直接开空 editor；`btn-discover` 调 `fetchDiscover` 但 session **未传 `handleDiscover`** → 404
- Server 路由壳已有 `POST /api/discover`；`hydrateProviderCredentials` 可恢复 SecretRef
- Core：`discoverModelIds` + command trust + 15s deadline

## 现状如何工作

一句话：**catalog/enrich 已接；discover 路由与客户端都在，会话没接线；Add model 跳过源选择直接开表单。**

主路径：
1. Models toolbar → Add model → `onOpenEditor(null)` → 全字段 editor
2. Import from /models → `fetchDiscover` → 期望 `{ ids }` → import tray → enrich 批处理
3. 官方填充在 editor 内（issue 1）

## 影响范围

- **必须修改**
  - `session.ts`：`handleDiscover`（hydrate 凭证 + `discoverModelIds` + 生产 command runner）
  - `model-view.ts` / `style.css`：Add model 源选择器
  - session 测试：`/api/discover` 200 与错误码
- **需要验证**
  - SecretRef apiKey/headers 可发现；缺 baseUrl → 可读错误
  - import tray 在发现成功后仍可 select/enrich/apply
  - agent-browser 三源入口
- **仍待调查**：无

## 方案判断

最小改动：复用已有 discover/import tray/editor，不新造 import 流水线。信任边界用 snapshot 作 `initialProvider`、draft 经 hydrate 作请求 provider。

## 实现设计

### 这次要怎么做

让「Add model」先问来源，再进入已有能力：

```text
Add model
  ├─ Search official catalog → open editor（现有 fill）
  ├─ Enter custom model     → open editor
  └─ Import from /models    → discover → import tray
```

### 功能怎么分工

1. **Session discover**
   - 输入：`{ providerKey, provider }`（浏览器 draft 片段，可能含 SecretRef）
   - `hydrateProviderCredentials(providerKey, provider, secrets, snapshot.revision)`
   - `initialProvider` = session 打开时 snapshot 中该 provider 的 apiKey/headers（command trust）
   - `discoverModelIds({ baseUrl, apiKey, headers }, { initialProvider, runCommand: createProductionCommandRunner() })`
   - 返回 `{ ids }`；`ModelSourceError` → 带 `code` 抛出，路由已映射 400/408/413/502

2. **Add source chooser**
   - 点 Add model → 小 dialog：Official catalog / Custom model / Import from /models
   - Official/Custom → `onOpenEditor(null)`
   - Import → 触发与 `btn-discover` 相同逻辑
   - 工具栏可保留 Import 快捷入口

3. **边界**
   - 不改 SecretRef/revision/commit
   - 不在浏览器展开明文密钥
   - discover 失败可见错误，不假装成功

### 一步步怎么改

1. session 接线 + 测试
2. chooser UI + 绑定
3. build:web + agent-browser

### 怎么确认做对

| 行为 | 预期 |
|---|---|
| Add → Official | 打开 editor |
| Add → Custom | 打开 editor |
| Add → Import 或 Import 按钮 | discover 200 + import tray |
| 缺 baseUrl | 可见 invalid_request |
| SecretRef 密钥 | 可发现（mock/真实环境） |
| 单测 | handleDiscover 接线 |

## 验证

- （实现后填）

## 执行记录

- （未开始）

## 关闭回写

- epic：Add 主路径与 discover 完成事实

## 关闭结论

- （关闭时填）

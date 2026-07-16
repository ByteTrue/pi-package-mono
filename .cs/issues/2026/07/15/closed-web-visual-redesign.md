---
kind: issue
title: "Web 全表面视觉重设计"
type: feature
status: closed
created: 2026-07-15
epic: ".cs/epics/2026/07/14/vendor-web-productization/spec.md"
---

# Web 全表面视觉重设计

## 目标

把 pi-vendor Web 从原型式黑底表单升级为完整、克制、高密度的本地配置工具：用户能在同一套清晰的视觉语言中管理 provider、模型、官方 catalog、导入、Raw JSON 与保存，而不失去安全状态与任务反馈。

## 范围

- 包含：全局 tokens、app shell、provider 侧栏/详情、模型列表/编辑器、catalog/import、Raw JSON、Preview、confirm/error/empty/loading/success 状态、桌面与窄屏响应式、键盘焦点与 reduced-motion
- 不包含：主题切换、远程字体/CDN、运行时 UI 框架、业务语义或 Config core 重写

## 归属

- 隶属 epic：`.cs/epics/2026/07/14/vendor-web-productization/spec.md`
- 视觉方向：克制深色、高密度本地工具；参考 Linear / Raycast

## 背景与证据

- 当前 style：`packages/pi-vendor/src/web/client/style.css`
- 当前 provider view：`packages/pi-vendor/src/web/client/provider-view.ts`
- 产品约束：`packages/pi-vendor/PRODUCT.md`
- 用户确认：重设计覆盖整个 Web，不只是布局优化

## 现状如何工作

当前 Web 使用单一黑灰配色与平铺表单。provider 详情、models、catalog/import 和保存动作同页堆叠，重复动作、长页与弱状态层级使配置任务难以扫读。业务 state/API 安全语义已存在，本 issue 只重建其呈现和交互骨架。

## 影响范围

- 必须修改：`packages/pi-vendor/src/web/client/` 的 CSS 与视图标记；必要时为可访问性/状态呈现做最小 client state 调整
- 需要验证：各主视图、dialog、所有状态、桌面/窄屏、键盘焦点、reduced motion；agent-browser 实测
- 仍待调查：设计 brief 确认后明确组件契约与是否需拆子 issue

## 方案判断

优先形成一个统一本地 CSS 视觉系统和明确的信息层级，而非逐块加样式补丁；不引入依赖。功能 issue 在新骨架上推进，避免同一处 DOM/CSS 被反复推倒。

## 实现设计

### 已确认的设计契约

- **用户与主动作**：用户在临时本地 session 内完成「选择 provider → 管理 models → 审查变更 → Save & Close」；Save 是唯一主终点，Raw、Preview、catalog 与 import 是逐步展开的工具。
- **视觉语言**：Restrained 深色高密度本地工具；近黑表面分层，偏青绿只用于 primary action、当前选择与成功。参考 Linear 的层级/密度、Raycast 的控制感、VS Code Settings 的可扫表单。
- **拒绝项**：渐变、玻璃卡片、卡片墙、营销式标题、泛滥圆角、远程字体/CDN、主题系统、运行时 UI 框架与装饰性动效。
- **空间结构**：固定 command bar（草稿状态 / Preview / 唯一 Save），固定 provider rail，主 workspace。Provider 设置、Models 主区、逐步展开的 catalog/import，以及独立 Raw/Preview 工作态按任务排列。
- **响应式**：桌面保留 rail + workspace；窄屏变为 provider strip，工具栏换行，表格重排为可扫行式信息；核心功能不隐藏、不横向溢出。

### 组件与状态契约

1. 本地 CSS token 系统：深色 surface 层级、文本、边界、accent 与 semantic error/warning/success；固定 type/spacing/radius/elevation/z-index/motion tokens。
2. 按语义统一 Button、form control、section、status message、dialog、table/list、toolbar 组件状态：default / hover / focus-visible / active / disabled / loading / error / success。
3. Secret keep-value 用「已配置」和 Replace / Remove 讲用户任务；不暴露 opaque 实现术语。
4. loading 使用与目标区域形状一致的 skeleton/进度反馈；error 说明结果和恢复动作；empty state 给下一步。
5. 仅用 150–220ms 的 state feedback；`prefers-reduced-motion` 下移除非必要 transition/animation。

### 实现顺序

1. 写 tokens 与 app shell，去除重复 Save/Preview 动作，建立 workspace 结构。
2. 重排 provider detail + models 主区，再重做 editor/dialog。
3. 收口 catalog/import、Raw、Preview 和 success/error/empty/loading 状态。
4. 做窄屏结构重排与键盘/焦点校验。
5. `build:web` 后用 agent-browser 对真实 session 做 desktop/narrow、provider/model、catalog、Raw/Preview、dialog 和状态走查。

### 边界

- 业务 API、Config core、SecretRef、revision、catalog/enrich/discover 语义不在本 issue 重写。
- DOM 调整只为信息架构、可访问性或状态可见性服务；功能主路径剩余缺口仍由后续 issue 处理。

## 验证

- Web 全表面在 Playwright 中可完成 provider/model 管理、catalog/search、import、Raw/Preview、Save/Cancel
- 空、loading、error、dirty、success、secret keep-value、confirm 等状态各有可读、可恢复表达
- 1280px 桌面及 640px 窄屏无横向溢出；键盘焦点清楚；`prefers-reduced-motion` 无不必要动画
- 既有 vendor tests、typecheck、build:web 通过

## 执行记录

- 以本地 CSS tokens 重建深色 surface、文字、accent、semantic state、spacing、radius、focus、motion 与 responsive 基座；未引入依赖、远程资产或主题系统。
- 重做 command bar / provider rail / workspace：唯一 Save & Close 固定在 command bar；provider settings、models、Raw 与 Preview 按任务分层，删除了原页面内重复 Save/Preview。
- 重做 model table/editor、catalog、import tray、Raw JSON、Preview、provider/secret/error/empty/terminal states 的视觉与用户文案；secret 表现为「已配置」与可执行操作，仍不暴露明文。
- 窄屏改为 provider strip、单列 form、行式 model table 和全宽 dialog action；修复 mobile layout 横向溢出（390px：document/body width 均为 375px）。
- agent-browser：走查 desktop provider workspace、model editor、`5.6` catalog candidates + fill、Raw JSON、Preview、窄屏和 12-model provider；浏览器 console/errors 为 0。
- Owner follow-up：app shell 改为真正 viewport grid，body 不滚动；command bar 与 provider rail 固定，只有 detail workspace 滚动。Model editor 在桌面改为宽幅双栏：左侧配置、右侧官方候选；dialog 外层不滚动，25+ 候选只在右 pane 内滚动；窄屏退回单栏。
- 回归修复：app-shell CSS 替换曾误删品牌、控件、provider list 的组件基座，导致浏览器原生灰色控件；已恢复并用 agent-browser computed styles + 截图确认。`dev:web` 静态资源改为请求时读取，client rebuild 后硬刷新不再拿到 server 启动时旧 CSS。
- 验证：`npm --workspace @bytetrue/pi-vendor test`（290 passed）、typecheck、build:web 通过。
- Owner follow-up：候选列表隐藏视觉滚动条（仍可滚）；模型编辑器扩展为 Pi closed DTO 全字段，Fable 模板填充后 thinkingLevelMap/input/cost/compat 全部可见；填充后保留 candidates 便于切换官方源。
- 最新验证：`npm --workspace @bytetrue/pi-vendor test`（293 passed）；agent-browser 确认 Fable fill + 无滚动条视觉。
- Owner follow-up：全局隐藏滚动条（`* { scrollbar-width: none }` + webkit）；主区 / sidebar / catalog / editor panes 仍可滚；agent-browser 实测 `scrollbarWidth: none` 且 `scrolled: true`。

## 关闭回写

- epic：`.cs/epics/2026/07/14/vendor-web-productization/spec.md`（视觉骨架完成、全站无滚动条、editor 双栏与全字段）
- project spec：仅在 epic 完整关闭时毕业稳定视觉/交互原则

## 关闭结论

- **关闭判断**：owner 验收通过。Web 全表面已是固定 app shell 的深色高密度本地配置工具；全站滚动条隐藏、主区可滚；模型 editor 桌面双栏 + closed DTO 全字段。
- **验证摘要**：293 tests、typecheck、build:web；agent-browser 覆盖 desktop/narrow、Fable fill、候选可滚无条、console 0 error。
- **回写位置**：epic 当前推进。
- **遗留事项**：`/api/discover` 与 Add model 三源主路径 → `open-web-add-model-main-path`；动作文案精修 → `open-web-actions-copy`。

---
kind: issue
title: "Web 模型表单常用字段"
type: feature
status: closed
created: 2026-07-14
epic: ".cs/epics/2026/07/14/vendor-web-productization/spec.md"
---

# Web 模型表单常用字段

## 目标

- 包含：`id/name/api/baseUrl/reasoning/thinkingLevelMap/input/cost/contextWindow/maxTokens/headers/compat` 全字段展示与写回 draft
- `cost` 的基础四项直接数字输入；`thinkingLevelMap`、cost tiers、compat 与 headers 以结构化 JSON 区域呈现，官方填充后立即可见
- 不包含：反射任意未来未知字段；未知字段继续 round-trip 并由 Raw JSON 兜底

## 归属

- 隶属 epic：`.cs/epics/2026/07/14/vendor-web-productization/spec.md`
- 相关 spec：`.cs/spec/pi-vendor/index.md`

## 背景与证据

- talk：`.cs/talks/2026-07-14-vendor-web-productization.md`
- 对照 TUI：`packages/pi-vendor/src/tui/quick-add-model.ts`
- Web 落点：`packages/pi-vendor/src/web/client/models/`

## 已确认问题

- Owner 确认：Pi 当前模型字段数量有限，模型编辑器直接显示全部字段；cost 必须包含，不再延后。
- 候选列表需要保留滚动能力以容纳 25+ 结果，但隐藏视觉滚动条，不能遮挡内容或紧贴 Use 按钮。

## 现状如何工作

Web 已有 catalog/enrich API 与旁路 Official Catalog UI，但未接入模型编辑器主路径；编辑器字段薄；动作与布局偏原型。详见 epic 当前方案。

## 影响范围

- 必须修改：`packages/pi-vendor/src/web/client`（及必要时 session 暴露）
- 需要验证： vitest 相关 + 手动 `/vendor web`
- 仍待调查：实现时再定

## 方案判断

能力/路径优先于视觉；复用 model-source，不复制业务规则到前端。

## 实现设计

- 左侧配置 pane 按 **Identity / Capabilities / Cost & compatibility** 分组，保持常用字段紧凑、复杂对象可直接检查。
- `input` 用 Text / Image checkbox；`cost` 四项用 numeric input；`thinkingLevelMap`、cost tiers、compat、headers 使用 JSON textarea，以完整覆盖 closed DTO 而不为每个兼容 flag 增加几十个一次性控件。
- 每个复合字段由单一 editor action 整体替换；清空删除该键；无效 JSON 保留输入缓冲行为与现有错误策略。
- official fill 仍只应用 closed allowlist 字段并保留 headers；填充 Fable 后所有 `thinkingLevelMap/input/cost/compat` 值必须在表单可见。

## 验证

- agent-browser：`claude-fable-5` 官方填充后显示完整字段：
  - name/api/reasoning/input/cost/context/maxTokens/thinkingLevelMap/compat
  - cost = 10/50/1/12.5；compat 含 forceAdaptiveThinking
- 25 条候选可滚动且滚动条隐藏（`scrollbar-width: none`，`canScroll: true`）
- 窄屏 390：editor 单栏，无横向溢出；cost 网格 2 列
- 填充后保留候选列表，便于切换官方源
- tests: 293 passed；typecheck/build:web 通过

## 执行记录

- model editor 改为全字段：Identity & limits / Capabilities / Cost / Compatibility & headers
- cost 四项数字输入 + tiers JSON；thinkingLevelMap/compat/headers JSON；input checkbox
- 候选区隐藏滚动条（仍可滚）；填充后保留 candidates
- 纯 helper：`buildEditorCost` / `buildEditorInputModes` / `parseEditorJson` + 单测

## 关闭回写

- epic：模型编辑器覆盖 closed DTO 全字段；cost 已纳入
- project spec：待 epic 关闭时再毕业

## 关闭结论

- **关闭判断**：owner 验收通过。编辑器展示并写回 id/name/api/baseUrl/reasoning/thinkingLevelMap/input/cost/contextWindow/maxTokens/headers/compat；Fable 官方填充后字段完整可见。
- **验证摘要**：agent-browser Fable fill 字段齐全；buildEditorCost/input helpers 单测；293 tests。
- **遗留事项**：compat 细控件（每个 flag 单独开关）不做；未知字段仍靠 Raw JSON。

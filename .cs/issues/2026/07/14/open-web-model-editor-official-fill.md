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

- 包含：编辑器内 catalog/enrich 入口、歧义选择、加载/错误态、与已确认填充策略一致
- 不包含：完整表单字段补齐、布局大改、TUI 改动

## 归属

- 隶属 epic：`.cs/epics/2026/07/14/vendor-web-productization/spec.md`
- 相关 spec：`.cs/spec/pi-vendor/index.md`

## 背景与证据

- talk：`.cs/talks/2026-07-14-vendor-web-productization.md`
- 对照 TUI：`packages/pi-vendor/src/tui/quick-add-model.ts`
- Web 落点：`packages/pi-vendor/src/web/client/models/`

## 待确认问题

- 实现设计阶段再细化交互文案与精确字段列表

## 现状如何工作

Web 已有 catalog/enrich API 与旁路 Official Catalog UI，但未接入模型编辑器主路径；编辑器字段薄；动作与布局偏原型。详见 epic 当前方案。

## 影响范围

- 必须修改：`packages/pi-vendor/src/web/client`（及必要时 session 暴露）
- 需要验证： vitest 相关 + 手动 `/vendor web`
- 仍待调查：实现时再定

## 方案判断

能力/路径优先于视觉；复用 model-source，不复制业务规则到前端。

## 实现设计

（Design 模式填写）

## 验证

- 1) 新增：输入已知官方 id → 字段被模板填充
2) 多 provider 歧义可选
3) 编辑已有：确认后覆盖模板字段，headers 保持
4) 现有 Save 仍只改 draft，不直接写盘

## 执行记录

- （未开始）

## 关闭回写

- epic / project spec：（关闭时填）

## 关闭结论

- （关闭时填）

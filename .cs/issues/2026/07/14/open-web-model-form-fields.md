---
kind: issue
title: "Web 模型表单常用字段"
type: feature
status: open
created: 2026-07-14
epic: ".cs/epics/2026/07/14/vendor-web-productization/spec.md"
---

# Web 模型表单常用字段

## 目标

模型编辑器覆盖日常常用字段（至少 input/compat/thinking 等已在 DTO 中的非密钥字段），高级仍靠 Raw JSON。

## 范围

- 包含：字段展示与写回 draft
- 不包含：强制 cost 映射（未确认前可选）

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

- 不打开 Raw 也能改常用非密钥字段；round-trip 不丢未知字段

## 执行记录

- （未开始）

## 关闭回写

- epic / project spec：（关闭时填）

## 关闭结论

- （关闭时填）

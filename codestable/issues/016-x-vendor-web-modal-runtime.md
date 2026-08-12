---
kind: issue
title: "Web 一次性 modal runtime"
type: feature
status: closed
created: 2026-07-12
epic: "codestable/epics/001-x-vendor-dual-ui-manager/spec.md"
superseded_by: "codestable/epics/003-x-vendor-ai-first/spec.md"
---

# Web 一次性 modal runtime

> **Superseded（2026-07-29）**：该 Web/双界面产品承诺已被 AI-first epic 取代；记录仅保留历史证据，当前实现不再包含 Web surface。

## 目标

loopback server + token/CSP + opaque SecretRef + Save/Cancel 闭环

## 范围

- 包含：本 feature 在旧 roadmap item `vendor-web-modal-runtime` 中定义的交付面
- 不包含：其他 feature 的范围；npm 发版

## 归属

- 隶属 epic：`codestable/epics/001-x-vendor-dual-ui-manager/spec.md`
- 相关 spec：`codestable/spec/pi-vendor/index.md`

## 背景与证据

- 旧 feature 目录：`codestable/archive/codestable-legacy/features/2026-07-12-vendor-web-modal-runtime/`
- 旧 items：`codestable/archive/codestable-legacy/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-items.yaml`

## 现状如何工作

迁移时该能力已在代码中落地；本 issue 记录关闭结论，不重做实现。

## 影响范围

- 必须修改：`packages/pi-vendor` 对应子系统（已完成）
- 需要验证：包测试 / typecheck /（hardening）pack-smoke
- 仍待调查：无

## 方案判断

共享 core + 表面编排；详见 archive design。

## 实现设计

完整 design 保留在 archive，不在此重复。关闭时以 accepted acceptance 为准。

## 验证

- 旧 QA/acceptance 文档：`codestable/archive/codestable-legacy/features/2026-07-12-vendor-web-modal-runtime/`
- 仓库测试：`npm --workspace @bytetrue/pi-vendor test`（关闭时套件绿）

## 执行记录

- web session/routes/static minimal page
- 关闭于 dual-UI roadmap complete（2026-07-14）

## 关闭回写

- epic：`codestable/epics/001-x-vendor-dual-ui-manager/spec.md`（issue 列表与完成事实）
- project spec：`codestable/spec/pi-vendor/index.md`（能力与术语毕业）
- notes：按需（原子写 / archive 指针）

## 关闭结论

- 关闭判断：feature accepted；first-terminal-action-wins、session slot 同步 claim
- 验证摘要：独立 review + QA/acceptance 在旧目录；自动化测试绿
- 回写位置：epic + project spec pi-vendor
- 遗留事项：见 epic 暂不推进（UX polish / 发版）

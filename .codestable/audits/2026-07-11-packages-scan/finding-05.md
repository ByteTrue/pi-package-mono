---
doc_type: audit-finding
audit: 2026-07-11-packages-scan
finding_id: "maintainability-01"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-refactor
status: deferred
---

# Finding 05：command.ts 近 600 行单体交互流

## 速答

`/vendor` 的全部 TUI 状态机（选 provider、编辑字段、管理 models、OpenAI import、保存确认）堆在单文件，超过 80 行函数多处，后续改菜单或加字段成本高。

## 关键证据

- `packages/pi-vendor/src/command.ts` — 约 596 行，含 `addManualModel`、`manageModels`、`editProviderDraft`、`registerVendorCommand` 等长循环
- `packages/pi-vendor/src/command.ts:198-269` — `addManualModel` 双层 for 循环 + 多路 UI 分支
- `packages/pi-vendor/src/command.ts:406-487` — `editProviderDraft` 巨型 if 链
- 同目录已拆 `models-json.ts` / `openai-models.ts` / `custom-select.ts`，UI 编排层未再拆

## 影响

- 回归面大、diff 噪音大；新菜单项易漏 cancel/back 路径
- 无运行时故障，纯维护成本

## 建议动作

`cs-refactor`：按 `provider-menu` / `model-menu` / `save-flow` 拆文件，保持现有行为。

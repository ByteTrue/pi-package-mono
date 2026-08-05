---
kind: issue
title: "快改：状态栏显示后台任务数"
type: ff
status: closed
created: 2026-08-04
epic: ""
---

# 快改：状态栏显示后台任务数

## 做了什么

- 当前 session 有后台任务运行时，Pi footer 显示极短的 `bg:N`。
- 运行数归零时清除状态，不显示空占位。
- 启动、自然结束、超时、失败和手动停止都通过 manager 生命周期统一刷新计数。
- 包版本升级为 `0.3.1`。

## 改了哪些

- `packages/pi-background-terminal/package.json`
- `package-lock.json`
- `packages/pi-background-terminal/src/background/manager.ts`
- `packages/pi-background-terminal/src/index.ts`
- `packages/pi-background-terminal/src/index.test.ts`
- `packages/pi-background-terminal/README.md`
- `.cs/spec/pi-background-terminal/index.md`

## 怎么验证

- `npm --workspace @bytetrue/pi-background-terminal test`：31 tests passed。
- `npm --workspace @bytetrue/pi-background-terminal run typecheck`：通过。
- `git diff --check`：通过。

## 对 `.cs/` 的影响

- 已同步 `.cs/spec/pi-background-terminal/index.md`：footer 仅在有运行任务时显示 `bg:N`，归零即清除。

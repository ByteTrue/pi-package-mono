---
kind: issue
title: "快改：隐藏 background 菜单终态任务"
type: ff
status: closed
created: 2026-08-04
epic: ""
---

# 快改：隐藏 background 菜单终态任务

## 做了什么

- `/background` 只列出仍为 `running` 的任务，不再展示 `exited`、`killed`、`timed_out`、`failed` 历史记录。
- 终态记录与输出仍保留给 `background_status` 查询，避免完成通知刚到就丢失证据。

## 改了哪些

- `packages/pi-background-terminal/src/background-command.ts`
- `packages/pi-background-terminal/src/background-command.test.ts`
- `packages/pi-background-terminal/README.md`
- `codestable/spec/pi-background-terminal/index.md`

## 怎么验证

- `npm --workspace @bytetrue/pi-background-terminal test`：30 tests passed。
- `npm --workspace @bytetrue/pi-background-terminal run typecheck`：通过。
- `git diff --check`：通过。

## 对 `codestable/` 的影响

- 已同步 `codestable/spec/pi-background-terminal/index.md`：菜单只管理运行中任务，终态记录由 `background_status` 查询。

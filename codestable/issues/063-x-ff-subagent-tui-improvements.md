---
id: "063"
title: "feat: subagent tui improvements with esc back navigation, fuzzy model picker with wrap around, task monitor, and status bar"
type: ff
status: closed
created_at: "2026-09-03T09:00:00Z"
closed_at: "2026-09-03T09:30:00Z"
---

# 063 · Subagent TUI improvements & Task Monitor

## 做了什么
1. **ESC 返回上一级（Back Navigation）**：重构 `/subagent` 交互菜单为栈式/循环导航，在子菜单任何步骤按 ESC 均返回上一级菜单，根菜单按 ESC 退出。
2. **模型选择模糊搜索与循环滚动（Wrap Around）**：实现交互式 `FuzzyModelPicker`，支持实时输入关键字进行模糊匹配过滤，在第一项按向上跳转至最后一项，最后一项按向下跳转至第一项。
3. **在菜单中查看运行中的 Subagent**：新增 `View Active Subagents` 任务监控面板，列出当前会话所有前台与后台 subagent，支持查看实时输出、查看恢复指南，以及主动终止运行中的任务。
4. **状态栏简易状态联动**：无论前台还是后台，只要有 subagent 正在执行，屏幕底部状态栏立即显示 `sub:N`（N 为当前正在运行的任务数），全部结束时自动清除。

## 改了哪些
- `packages/pi-subagent/src/tui-picker.ts` (新建)
- `packages/pi-subagent/src/command.ts`
- `packages/pi-subagent/src/command.test.ts` (新建)
- `packages/pi-subagent/src/index.ts`
- `packages/pi-subagent/src/index.test.ts`
- `packages/pi-subagent/package.json`
- `packages/pi-subagent/README.md`
- `codestable/spec/pi-subagent/index.md`

## 怎样验证
- `npm run typecheck --workspace @bytetrue/pi-subagent` → 通过
- `npm run test --workspace @bytetrue/pi-subagent` → 15/15 通过
- `npm test` → 全 monorepo 13 套测试套件 100% 通过

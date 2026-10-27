---
kind: issue
title: "快改：ask_user 对话框等待期间隐藏工作指示器（Windows Terminal 挂起）"
type: ff
status: closed
created: 2026-10-28
epic: ""
---

# 快改：ask_user 对话框等待期间隐藏工作指示器

> 做了什么 · 改了哪些 · 怎么验证 · 对 `byissue/` 有无影响

线上事故：Windows 11 + Windows Terminal 1.24 + pi 1.4.0 全屏（alt-screen）模式下，
弹 `ask_user` 对话框后长时间不回答，`WindowsTerminal.exe` 变成「未响应」，只能强杀。
已发生 2 次。

## 根因（两层）

1. **终端侧**：Windows Terminal 1.24 自身的内存泄漏/挂起缺陷（事件日志
   `Application Hang` 与 `RADAR_PRE_LEAK_64` 均有记录）。
2. **pi 侧放大器**：等待期间 pi 仍在以 12.5 帧/秒全量重绘整幅 alt-screen。
   `pi-tui` 的 `Loader` 每 80ms 一次 `requestRender()`（`DEFAULT_INTERVAL_MS = 80`），
   全屏模式每帧重建 `renderCache`，对含整段聊天记录的组件树重新布局渲染。
   弹扩展对话框时（`pushExtensionDialog`）没有任何代码停掉这个定时器，而等待时长
   是小时级：session 里 96 次已完成的 `ask_user` 调用中最长 **676 分钟**，
   86 分钟那次关闭后 26 秒即记录终端挂起。

## 修法

在扩展内部用 `ctx.ui.setWorkingVisible(false)` 包住每个对话框，`finally` 里恢复。
该开关走 `clearStatusIndicator("working")` → `indicator.dispose()` →
`Loader.stop()` → `clearInterval()`，**定时器真的停掉**，不是渲染成透明。

- `withoutWorkingSpinner(ctx, run)`：`ctx.mode !== "tui"` 完全不干预（print/JSON/RPC 无指示器）。
- 两个对话框原语各包一次：选项列表（`selectDialog` 包 `ctx.ui.select`）、
  自由输入（`collectFreeform` 包 `ctx.ui.editor` / `ctx.ui.input`）。
  多选循环与 Other 串联因此天然「每次进出对话框各成一对」，不泄漏状态。
- 零运行时 import 不变（改的只是 `ctx.ui` 调用）。

## 已知局限（未解决，别当成已修）

- **只覆盖 ask_user**：`/model` 选择器、确认框、登录框、`showExtensionConfirm` /
  `showExtensionEditor` 等等待期间转圈仍在跑。
- **恢复的是 pi 的默认值而非用户原值**：`setWorkingVisible` 无 getter。本仓库目前
  没有扩展全局 `setWorkingVisible(false)`，故无冲突；真正的通修在上游——对话框压栈
  时应暂停 `activeStatusIndicator`。
- **终端侧根因不在本仓库边界**：仍挂起则升级 Windows Terminal（1.25+）或换 WezTerm。

## 改动与验证

- 改动：`small-extensions/pi-ask-user/pi-ask-user.ts`、`pi-ask-user.test.ts`、
  `README.md`、`byissue/spec/index.md`（形态边界一行）
- 测试：fake ctx 记录 `setWorkingVisible` 调用序列，6 条用例——正常选、自由输入、
  取消后仍恢复、Other 两次对称进出、非 TUI 一次都不调、对话框抛异常仍恢复。
  变异验证：把 helper 改成不调 `setWorkingVisible`，5 条用例立刻红。
- 命令：`npm --workspace pi-ask-user run typecheck` + `test`（24 passed）+
  全仓 `npm run typecheck --workspaces --if-present` + `npm test`
- 未自测（需人工）：真实终端里开着对话框离开 ≥10 分钟，确认屏幕静止、对话框仍响应。
  安装器只从 GitHub main 拉取，需先推送再 `node scripts/install-small-extension.mjs` + `/reload`。
- byissue：已同步 `byissue/spec/index.md`

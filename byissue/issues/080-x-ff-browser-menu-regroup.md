---
kind: issue
title: "/browser 二级菜单重组 + Browser 切换入口 + 只读 Status 面板"
type: ff
status: closed
closed: 2026-09-14
created: 2026-09-14
---

# /browser 二级菜单重组 + Browser 切换入口 + 只读 Status 面板

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

做了什么：`/browser` 主菜单从 8 项平铺改为二级结构 —— **Status / Browser: X / Login data / Sessions / Settings / Setup / Close**。新增 `Browser: X` 一级入口显示当前浏览器（config channel 优先，回落 state.lastImport），选中后列出检测到的源浏览器（当前项标 `— current`），选定即走该浏览器的 Import 流程（pinnedBrowserId 直达 profile 选择）；不提供脱离导入的自由 channel 开关（Keychain 与导入来源强耦合，075 既定约束）。Status 与安装失败输出从 `ctx.ui.editor()` 改为 `ctx.ui.custom()` 只读 overlay 面板（`makeReadOnlyPanel`，Esc/Enter/q 关闭，pi-tui Text + matchesKey）。

- 改动：`packages/pi-browser/src/browser-command.ts` — 菜单重构、`currentBrowserId`/`describeCurrentBrowser`/`runBrowserMenu`/`runLoginMenu`、`showReadOnlyPanel`、`runImportFlow` 加 `pinnedBrowserId`；`package.json` — 加 `@earendil-works/pi-tui >=0.84.3` peer；`README.md` — 菜单描述同步。
- 验证：70 单测全绿（新增 Browser 切换用例：msedge→chrome 重导后 config channel/userDataDir 正确；Status 走 custom 面板且 editor 不再被调用）；`tsc --noEmit` 通过（补了 Component 必需的 `invalidate()`）；全仓 `npm test` 绿。
- codestable：已同步 `spec/pi-browser/index.md`（当前表面菜单结构、Status 呈现方式、Settings 注记文案）。

顺手发现：登录态导入不支持 Firefox/WebKit —— CLI 的 `--browser` 虽列 chrome/firefox/webkit/msedge，但导入管线（Local State/leveldb/Keychain channel 配对）是 Chromium 专用，本次确认为明确边界，与用户达成一致不做。

---
kind: issue
title: "Manual sign-in 窗口入口 + Status 面板加边框"
type: ff
status: closed
closed: 2026-09-14
created: 2026-09-14
---

# Manual sign-in 窗口入口 + Status 面板加边框

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

两个用户反馈：① 080 的只读面板无边框，和聊天背景糊在一起；② Google 这类 source-bound 站点导不进登录态，用户没有方便的途径在 managed profile 里手动登录。

做了什么：面板改用 Pi 内置对话框同款结构（`Container` + `DynamicBorder` 上下边框、`Text` 1 字缩进、muted 的 `Esc — close`），边框颜色由 `theme.fg("border", …)` 传入；Login data 菜单加 **Manual sign-in (opens a window)** —— 检查 config/channel、profile 存在、未被 SingletonLock 占用后，confirm 并执行 `playwright-cli -s=pi-browser-login open --headed about:blank`，会话保持运行由 Sessions 收尾（该会话额外标 `— sign-in window`）。

关键事实（决定了功能形态）：managed profile 是**副本**，`buildStagingProfile` 是"保留现有 + 按文件覆盖快照"，Cookies（SQLite）与 storage（leveldb）无法字段级合并 → **重导会整体冲掉手动登录**。因此 confirm 文案与菜单标题都明确写了这一点；未提供持久增量合并（做不到）。

- 改动：`src/browser-command.ts`（面板边框、`runManualSignIn`、`runLoginMenu`、Sessions 标签、导入 confirm 补一行提示）；`src/import/verify.ts`（新增 `LOGIN_SESSION`、`openLoginWindow`）；`README.md`、`codestable/spec/pi-browser/index.md` 同步。
- 验证：pi-browser 72 单测全绿（新增 2 例：起窗口时执行的确切命令 + 未导入前拒绝开窗）；`tsc --noEmit` 通过；真机实测 `playwright-cli -s=pi-browser-verify open --headed about:blank` exit 0、`list --all` 显示该会话 `headed=True` 且 userDataDir 指向 managed profile、`close` 正常（`--headed` 与持久 profile 通路成立）。
- codestable：已同步 spec（Status 呈现、Login data 子项、Manual sign-in 段、原子替换的"整文件覆盖"推论、已知限制新增一条、回归清单）。

**后续决策（同日）：** 用户反馈"同步一次就把手动登录全冲掉，体验太差"，为此实测了 `state-save`/`state-load`/`cookie-set` 与持久化语义（结论：冲掉是文件级覆盖的必然，要绕开得建 vault+replay 双层），用户判定成本不值——**明确接受重导后手动登录失效**，不做双层。依据与重评入口：`codestable/notes/008-chromium-profile-login-state-primitives.md`。

顺手发现：`sessions.ts` 的 `CliSession` 类型未暴露 headed 字段（CLI 的 `list --json` 里有 `headed: true`），本次只用会话名匹配标 `— sign-in window`，未扩类型。

**同日的收尾形态修正（用户要求"不常见但一定要稳定"）：** 上一版的 Manual sign-in 把收尾交给用户（开窗 → 告知去 Sessions 关）。实测发现那不可靠：`playwright-cli` 0.1.19 下，用户关掉 headed 窗口的最后一个页面后，**浏览器主进程树仍存活（5 个进程）、`SingletonLock` 仍在、`list` 仍报 `headed=True`**，只有 `close` 能真正拆除（close 后进程归零、锁消失、list 空）。因此改为**引导式**：开窗 → 阻塞在一个 input 提示（"登录完回这里按 Enter"）→ 无论 Enter 还是 Esc 都由 `closeLoginWindow()` 主动关，失败则降级提示去 Sessions。新增 `openLoginWindow`/`closeLoginWindow`/`LOGIN_SESSION` 均在 `import/verify.ts`。测补 2 例（open→wait→close 的完整命令序列；close 失败时只发 warning、不谎报成功），pi-browser 73 全绿 + typecheck 干净。实测临时目录已清理，未触碰真实 managed profile。

---
kind: issue
title: "pi-browser 升级为 agent-browser 管理器（浏览器选型 + 登录态管理 + 观测大屏）"
type: feature
status: closed
created: 2026-09-15
---

# pi-browser 升级为 agent-browser 管理器（浏览器选型 + 登录态管理 + 观测大屏）

## 背景与问题

此前采用单一全局 `profile` 目录作为登录身份方案，但 Chromium 核心的 `ProcessSingleton` 在操作系统层硬性禁止两个独立 Chrome 进程挂载同一个 Profile 目录，第二进程必报 `exit 21 (profile-in-use)` 崩溃。当用户有多会话并发需求、或关闭孤儿会话时，经常触发锁冲突。且强制指定测试浏览器并绑定全局 namespace，增加了不必要的限制。

用户明确决策：
1. **包定位升级为「agent-browser 管理器」**：专职负责运维管理，不当 Agent 工具、不拦截 Shell；
2. **浏览器默认留空 Auto，可在 Settings 中自由点选 Edge / Chrome / CfT / 自定义路径**；
3. **彻底删去全局 Profile、Session、Namespace 锁**；
4. **一等公民提供 Logins（登录态增删改查）与 Dashboard（实时观测大屏）管理**。

## 改动点

1. **移除全局 `profile`、`session`、`namespace` 锁**：
   - `packages/pi-browser/src/config.ts`：`mergeAgentBrowserConfig` 清理所有全局锁，各任务独立实例运行，彻底消除 exit 21。

2. **浏览器自由选型（Edge / Chrome / CfT / Auto）**：
   - `src/runtime.ts` 新增 `detectAvailableBrowsers()` 扫描平台安装的 Edge、Chrome、CfT；
   - `src/config.ts` 新增 `setExecutablePath()`；
   - Settings 菜单新增 `Browser:` 选项，点击弹出可视化候选列表切换。

3. **实时观测大屏管理（Dashboard）**：
   - 新增 `src/dashboard.ts`：管理本地 4848 端口 WebUI，提供快速 HTTP 状态检查、一键启动、停止、系统浏览器打开。
   - 主菜单新增 `Dashboard` 入口，Status 面板同步展示大屏状态。

4. **状态文件增删改查模块（Logins）**：
   - 新增 `src/auth-state.ts`：存放在 `<agent dir>/pi-browser/auth/*.json`；
   - 支持列表、查看详情、开窗登录并保存、带着旧 Cookie 刷新保存、改名、删除。

5. **验证**：
   - 9 个测试文件共 55 项单测全部通过；全仓类型检查通过；全仓全量测试通过。

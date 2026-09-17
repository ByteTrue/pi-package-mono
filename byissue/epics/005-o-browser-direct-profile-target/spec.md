---
kind: epic
title: "pi-browser：从真实 Profile 试验收敛到独立 agent-browser Profile"
status: closed
created: 2026-09-14
---

# pi-browser：从真实 Profile 试验收敛到独立 agent-browser Profile

> **读者：** 接手浏览器目标架构的人——这里保留为何不再直连真实 Profile，以及当前替换线做到哪。

## 这条线现在要改变什么

本 Epic 最初尝试让 Playwright 直接驱动用户的真实 Edge/Chrome Profile。M0 得到反证后，用户于 2026-09-15 改变核心方向：**不再把日常浏览器的命名 Profile 当作隔离边界，改用 agent-browser + Chrome for Testing + Pi 专用持久 user-data-dir。**

原因已经明确：同一 Edge 的 `Default` / `Profile 1` 等 Profile 仍共享浏览器总 user-data-dir 和进程锁，不能满足“和日常浏览器互不影响”。真实大档案直连还出现 180 秒超时并在失败前改写 111 个文件，不值得继续穿刺。

当前活规格以 `byissue/spec/pi-browser/index.md` 为准。一句话是：

> pi-browser 不再搬运或直连日常浏览器身份；只帮助用户安装前看命令、配置一个长期复用的独立测试浏览器 Profile，并清理遗留 agent-browser 会话。

## 用户锁定的产品边界

- 核心 CLI：`agent-browser >= 0.37.1`；浏览器为 `agent-browser install` 下载的 Chrome for Testing。
- Profile：`<agent dir>/pi-browser/profiles/agent-browser`，与旧 Playwright/Edge 副本分开。
- Setup 只打印以下命令，绝不代执行：

  ```bash
  npm install -g agent-browser
  agent-browser install
  npx skills add vercel-labs/agent-browser -a pi -y -g
  ```

- 本包只协助配置、修改设置、查看和清理僵尸会话。
- 不注册 agent tool、不拦截 Bash、不拒绝 CLI 参数、不净化环境变量、不试图锁死 Agent 的覆盖能力。
- agent-browser 用户 config 的 Profile/session/namespace 固定为 Pi 专用默认值，并显式写 `idleTimeout: "10m"`，让忘记 close 的 visible/headless 浏览器都能自动退出。
- 旧 `profiles/default` 不复用、不迁移、不自动删除。

## Issues 与证据

- [x] `issues/001-x-m0-real-profile-pierce.md` — 证明真实档案副本可解密，但活档案直连超时且产生写入；这条路不再继续。
- [x] `issues/002-x-target-decouple-and-gates.md` — 完成 Playwright 时代的 Target/Data 解耦与安全闸；现作为历史证据，代码由 issue 003 移除。
- [x] `issues/003-x-agent-browser-core-replacement.md` — 已实施并发布 `@bytetrue/pi-browser@0.3.0`：替换核心、重写配置/UI/session 管理、删除旧导入链并验证。

Windows 技术穿刺已经确认：agent-browser 0.37.1 的路径型 `profile` 会变成独立 `--user-data-dir`；关闭重开后 localStorage 保留；固定 session 可复用；`session list/info/close` 有 JSON 接口；显式 idle timeout 对 headed 会话也生效；自有 Chrome 跟随 daemon 的 Job Object 生命周期。

已知安装事实：本机 `agent-browser install` 曾在获取 Chrome for Testing 元数据时超时，而 curl 可访问同一地址。因此本包只展示官方命令与诚实状态，不替用户安装，也不声称命令已成功。

## 关闭条件

- [x] issue 003 的实现与完整验证完成；
- [x] `spec/pi-browser`、README 与包元数据只描述 agent-browser 当前真相；
- [x] 仓库不再保留可达的 Playwright、真实 Target、导入与旧 state 代码；
- [x] 真实 CLI 回归确认同一 Profile 持久化、固定 session/namespace、10 分钟 idle timeout、close/close-all/doctor cleanup；
- [x] 2026-09-15 用户授权关闭并发布（详见 issue 003 关闭时）。

原来的“活真实 Profile 登录页可用且不破坏档案”不再是关闭条件；方向已被用户明确撤销。

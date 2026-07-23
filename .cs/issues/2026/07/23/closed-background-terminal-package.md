---
kind: issue
title: "新增 OpenCode 对齐的 background terminal package"
type: feature
status: closed
created: 2026-07-23
---

# 新增 OpenCode 对齐的 background terminal package

## 目标

在**不改 Pi core** 的前提下，把 Pi 缺失的 background terminal 能力直接做成一个可装 package，并按 OpenCode `opencode-pty` 的产品语义对齐：真实 PTY、多会话、读历史输出、写 stdin、退出通知、loopback Web monitor。

## 范围

- 包含：`packages/pi-background-terminal` 新包、`pty_spawn` / `pty_list` / `pty_read` / `pty_write` / `pty_kill`、`notifyOnExit`、`timeoutSeconds`、Web monitor、project-local 加载与验证
- 不包含：Pi core 改动、tmux、Pi 退出后继续存活、npm 发版、权限弹窗系统

## 归属

- 本次按 owner 明确要求直接实现，不挂现有 epic。
- 相关真相：`.cs/spec/index.md`、`.cs/spec/pi-background-terminal/index.md`

## 背景与证据

- Pi 当前缺少像 Claude Code / Codex / OpenCode 那样的 background terminal。
- owner 明确收紧边界：**只做 package、不要改 Pi core、不要依赖 tmux、不要要求 Pi 退出后还活着、思路直接 1:1 对齐 OpenCode**。
- 现有实现落点：`packages/pi-background-terminal/src/`

## 现状如何工作

一句话：**这是一个绑定到当前 Pi session 的 PTY manager，不是 detached shell，也不是 tmux 持久会话。**

主路径：

```text
pty_spawn
  → SessionLifecycleManager 用 @lydell/node-pty 启 PTY
  → RingBuffer 累积输出 / PTYManager 按 parentSessionId 管理会话
  → pty_read / pty_write / pty_list / pty_kill 只操作自己的 session
  → notifyOnExit 时给原 Pi session 发 follow-up
  → /pty-open-background-spy 可开 loopback Web monitor
  → session_shutdown 清理该 Pi session 的全部 PTY
```

## 影响范围

- **必须修改**
  - `packages/pi-background-terminal/`：extension 入口、PTY manager、tools、commands、Web monitor、tests
  - `package-lock.json`：新增 `@lydell/node-pty`、`ws` 及前端 build 依赖
  - `.pi/settings.json`：本地开发时只启用本地 background-terminal 包
- **需要验证**
  - 5 个 tool 的 spawn/read/write/list/kill 语义
  - `notifyOnExit` follow-up
  - timeout kill、HTTP/WS monitor、pack dry-run
  - 当前 Pi session 内真实 reload 后可用
- **仍待调查**：是否发版，由 owner 另行决定

## 方案判断

- **不要 tmux / 不要 core 改造**：owner 已明确收口；持久化与 tmux 都会偏离 OpenCode 目标。
- **OpenCode 对齐是唯一 spec**：不做 Codex/OpenCode 混合版，不自行发明第二套协议。
- **`@lydell/node-pty` 是包内等价实现**：保持 package-only、跨平台、真实 PTY；对外呈现继续贴近 OpenCode `opencode-pty`。
- **会话生命周期跟 Pi session 走**：这不是宿主外持久后台；session 结束就 cleanup。

## 实现设计

### 这次要怎么做

1. 新建 `@bytetrue/pi-background-terminal` package
2. 注册 5 个 tool：`pty_spawn` / `pty_list` / `pty_read` / `pty_write` / `pty_kill`
3. 注册 2 个命令：`/pty-open-background-spy`、`/pty-show-server-url`
4. 做进程内 PTY manager、输出 buffer、退出通知与 loopback Web monitor
5. 在 `session_shutdown` 清理所有 live PTY

### 功能怎么分工

- `src/index.ts`：注册 tools / commands / renderer；接 Pi `session_start` / `session_shutdown`
- `src/pty/session-lifecycle.ts`：spawn、status、timeout、kill、cleanup
- `src/pty/buffer.ts` + `output-manager.ts`：行缓冲、raw buffer、regex read/search
- `src/pty/notification-manager.ts`：`notifyOnExit` follow-up
- `src/web/server/server.ts`：loopback REST + WebSocket monitor，带 token 与 Host/Origin 校验
- `src/pty/permissions.ts`：明确保留 package 层 default-allow；不假装已有 builtin bash approval matrix

### 怎么确认做对

| 行为 | 预期 |
|---|---|
| `pty_spawn` 启动短命命令 | session 出现在 `pty_list`，结束后状态为 exited/killed |
| `pty_read` | 能读历史输出；pattern 走 regex 搜索 |
| `pty_write` | 能把 stdin 发给活着的 PTY |
| `pty_kill cleanup=true` | 会话从列表消失 |
| `notifyOnExit` | 收到 follow-up，含退出码与最后一行 |
| Web monitor | HTTP 需 token；WS 可收 session list / raw output / updates |
| `session_shutdown` | 当前 Pi session 的 PTY 全部清掉 |

## 验证

- `npm --workspace @bytetrue/pi-background-terminal run typecheck`
- `npm --workspace @bytetrue/pi-background-terminal test`
  - `buffer.test.ts`：buffer 行为
  - `manager.test.ts`：spawn/output/notify、stdin write、timeout kill
  - `server.test.ts`：HTTP + WebSocket monitor
- `npm pack --workspace @bytetrue/pi-background-terminal --dry-run`
- 当前 Pi session 真机 smoke：
  - `pty_spawn` 跑 node PTY，首行输出 `pty-live`
  - `pty_write` 发送 `hello` / `quit`
  - `pty_read` 回读 `echo:hello`、`echo:quit`
  - follow-up 收到 `[pty_…] live pty smoke exited with code 0. Last line: echo:quit`
  - `pty_kill cleanup=true` 成功

## 执行记录

- 先做了竞品与 Pi 内部调研；最初一度把 v1 想成 tmux-backed 方案。
- owner 随后明确否决 tmux / 持久化 / core 改造，并要求**直接 1:1 对齐 OpenCode**；方案随即收口。
- 实现完成后，project-local 加载第一次踩中两个真实坑：
  1. `.pi/settings.json` 的本地路径是相对 `.pi/` 目录解析，必须写 `../packages/...`
  2. Pi 不会把项目本地包和全局同名包自动去重；同时启用会有 tool conflict
- 因此本 repo 的 `.pi/settings.json` 在本次开发验证阶段只保留本地 `pi-background-terminal` 包。

## 关闭回写

- project spec：`.cs/spec/index.md`（新增第四个包、能力地图、边界、阅读路径）
- package spec：`.cs/spec/pi-background-terminal/index.md`
- note：`.cs/notes/pi-local-package-loading.md`

## 关闭结论

- **关闭判断**：owner 已在当前 Pi session reload 后同意并实测；`pty_*` tools 与 `notifyOnExit` 可用。
- **验证摘要**：typecheck、6 tests、pack dry-run、当前 session live PTY smoke 均通过。
- **回写位置**：project spec + package spec + local package loading note。
- **遗留**：是否发 npm 版不属于本 issue；届时单独授权、单独处理。

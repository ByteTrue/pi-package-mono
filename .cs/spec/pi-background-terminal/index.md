# pi-background-terminal

## 这一层是什么

`@bytetrue/pi-background-terminal` 给 Pi 提供 **OpenCode `opencode-pty` 风格**的 background terminal：真实 PTY 会话、5 个 agent tools、退出 follow-up 通知，以及可选的 loopback Web monitor。它是 **package-only** 扩展，不改 Pi core。

Peer：`@earendil-works/pi-coding-agent` `>=0.79.10`。

## 它负责什么

- **`pty_spawn`**：启动受管 PTY session，记录 `id/title/description/command/args/workdir/pid/status`，支持 `notifyOnExit` 与 `timeoutSeconds`。
- **`pty_list` / `pty_read` / `pty_write` / `pty_kill`**：列会话、读缓冲、写 stdin、停止/清理会话。
- **会话绑定**：所有 PTY session 绑定到启动它们的 Pi session；`session_shutdown` 时清理该 session 的所有 PTY，并关闭 monitor server。
- **退出通知**：`notifyOnExit` 为真时，进程结束后向原 Pi session 投递 follow-up message，附带退出码、是否 timeout、输出行数与最后一行。
- **Web monitor**：`/pty-open-background-spy` 打开本地监视页，`/pty-show-server-url` 显示 URL；页面通过 REST + WebSocket 读 session 列表、原始输出和增量更新。

## 它不负责什么

- 不改 Pi core，不引入内建后台终端能力。
- 不依赖 tmux，不要求 Pi 退出后 PTY 继续存活。
- 不做常驻 daemon、固定端口、远程面板或跨 session 恢复。
- 不复用 Pi 内建 `bash` 的 approval / sandbox matrix；当前 package 层 permission check 明确保持 default allow，而不是假装已有同级安全闸门。

## 统一语言

- **PTY session**：一次受管背景终端会话，有稳定 `pty_<hex>` id、buffer、状态与父 Pi session。
- **parent Pi session**：创建该 PTY 的 Pi session；list/read/write/kill/cleanup 都按它隔离。
- **notifyOnExit**：进程结束时给原 session 发一条 follow-up，不要求 agent 轮询 `pty_read` 等退出。
- **cleanup**：删除 session 记录并清空 buffer；与普通 `kill` 不同，cleanup 后不会再出现在 `pty_list`。
- **Web monitor**：loopback-only 的临时监视页；URL 带随机 token，API/WS 校验 Host/Origin/token。

## 使用路径

| 想完成的事 | 入口 |
|---|---|
| 后台跑一个会持续输出的命令 | `pty_spawn` |
| 看当前输出 / 查历史行 | `pty_read` |
| 给进程发 stdin / Ctrl-C | `pty_write`（Ctrl-C 发 `"\x03"`） |
| 看当前 session 全貌 | `pty_list` |
| 真正停掉或删掉 session | `pty_kill` |
| 在浏览器里盯多条 PTY 输出 | `/pty-open-background-spy` |

## 子系统地图

```text
Extension entry
  ├─ tools: pty_spawn / list / read / write / kill
  ├─ commands: open-background-spy / show-server-url
  └─ PTYManager
       ├─ SessionLifecycleManager (@lydell/node-pty + timeout + status)
       ├─ OutputManager / RingBuffer
       ├─ NotificationManager (follow-up exit message)
       └─ PtyWebServer (loopback REST + WebSocket monitor)
```

## 架构考量

- **OpenCode 对齐优先**：tool 名称、会话生命周期、buffer/read/search、exit notify 与 Web monitor 都优先贴近 `opencode-pty`，而不是自发明混合协议。
- **跨平台真实 PTY**：用 `@lydell/node-pty` 承接 macOS/Linux/Windows 的 PTY，而不是 tmux 或 pipe 假终端。
- **session 范围隔离**：所有 manager 操作都带 `parentSessionId`；其他 Pi session 看不到或误杀不属于自己的 PTY。
- **monitor 默认只本地可达**：`127.0.0.1` + 随机端口 + bearer token + Host/Origin 校验；stop 时主动销毁 sockets。
- **package 约束说实话**：当前扩展拿不到 Pi 内建 bash 审批矩阵，因此 permission 行为必须在 spec 中明说，不把“默认允许”包装成已有安全边界。

## 当前边界

**做**
- 受管 PTY tools、内存 buffer、regex read/search
- `notifyOnExit` follow-up
- timeout kill 与 session-scoped cleanup
- loopback Web monitor

**不做**
- tmux / core 改造 / 跨 Pi 退出持久化
- 常驻服务、远程多用户管理、固定 URL
- 伪装成已有 builtin bash approval 行为

## 证据索引（按需）

- 包 README：`packages/pi-background-terminal/README.md`
- 入口：`packages/pi-background-terminal/src/index.ts`
- 生命周期：`packages/pi-background-terminal/src/pty/session-lifecycle.ts`
- 通知：`packages/pi-background-terminal/src/pty/notification-manager.ts`
- Web monitor：`packages/pi-background-terminal/src/web/server/server.ts`
- closed issue：`.cs/issues/2026/07/23/closed-background-terminal-package.md`

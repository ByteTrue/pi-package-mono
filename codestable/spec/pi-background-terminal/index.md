# pi-background-terminal

## 定位

`@bytetrue/pi-background-terminal` 提供三个独立 Agent 工具和一个 `/background` 用户菜单：后台启动命令、查看单个任务、停止单个任务。它不覆盖或注册任何 Pi 内建工具名，不改变 `bash`。

Peer：`@earendil-works/pi-coding-agent >=0.79.10`。npm `latest`：`0.4.0`。

## 当前表面

- `background_run(command)`：通过 Pi 的 `createLocalBashOperations().exec()` 启动命令并立即返回 task id 与输出文件路径。只用于需要越过本次工具调用继续运行的 dev server、watch mode 或长任务；普通命令使用内建 `bash`。
- `background_status(id)`：返回该任务的状态、退出码、输出文件路径、累计行数和约 4000 字符 tail。完整输出由 Agent 用内建 `read` 读取文件。
- `background_kill(id)`：停止仍在运行的任务；已结束任务返回当前状态。主动停止不发送完成 follow-up。
- `/background`：仅面向用户，列出当前 session 仍在运行的任务，可查看完整落盘输出或确认停止。Agent 工具不提供无参 list 模式。
- footer：当前 session 有运行任务时显示 `bg:N`，归零即清除。

三个 Agent tool 的参数全部必填，不包含 timeout、workdir、env 或输出分页策略。任务在命令退出、`background_kill` 或所属 session 结束时终止。

## 输出与生命周期

- stdout/stderr 实时写入 `$TMPDIR/pi-background-terminal/<task-id>.log`；内存只保存 tail 和行数。
- 输出文件不设应用层大小上限；读取预算与 offset/limit 交给 Pi 内建 `read`，不重复实现。
- 状态为 `running | exited | killed | failed`。非零退出仍是 `exited` 并保留 exit code；执行 backend 拒绝时才是 `failed`。
- 任务按 `parentSessionId` 隔离；`get`、`list`、`kill`、`clearSession` 都检查所属 session。
- 命令自然退出或执行失败后发送 `followUp + triggerTurn:true`，唤醒空闲 Agent；主动 kill 与 session 清理静默。
- 真正 session 结束时等待进程树和输出流结束，再删除对应文件。

## `/reload`

Pi 的 `/reload` 会在同一 session 重新加载 extension module。manager 因此固定在 `globalThis[Symbol.for(...)]`，并在 `session_shutdown.reason === "reload"` 时跳过清理；否则模块级 singleton 会被替换，旧任务将不可见且不可停止。新 session 仍按 `parentSessionId` 隔离。

## 使用路径

| 目的 | 入口 |
|---|---|
| 普通命令，等待结果 | Pi 内建 `bash` |
| 启动需要后台继续运行的命令 | `background_run(command)` |
| 查看一个任务 | `background_status(id)` |
| 阅读完整或大量输出 | `read` 读取 status 返回的文件路径 |
| 停止一个任务 | `background_kill(id)` |
| 用户浏览和管理运行中任务 | `/background` |
| 发布 npm 包 | tag `pi-background-terminal-v<version>` |

## 实现地图

```text
src/index.ts
  ├─ tools/background-run.ts
  ├─ tools/background-status.ts
  ├─ tools/background-kill.ts
  ├─ background-command.ts       /background 菜单
  └─ background/manager.ts
       ├─ createLocalBashOperations().exec()
       ├─ fs.createWriteStream()  → $TMPDIR/pi-background-terminal/<id>.log
       └─ globalThis[Symbol.for(...)]
```

完成通知使用 Pi 对 custom message 的默认 renderer，不注册自定义 renderer。

## 明确不做

- 覆盖或修改 Pi 原生工具；
- PTY、交互式 stdin、tmux、daemon、Web UI 或远程面板；
- 自动 timeout；
- 自定义 workdir/env；
- 自制 shell backend、输出分页或文件查看工具；
- Pi 退出后的进程持久化。

## 验证

```bash
npm --workspace @bytetrue/pi-background-terminal test
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm --workspace @bytetrue/pi-background-terminal pack --dry-run
```

真实 Pi 回归还应确认：三个 tool schema 只有必填参数；后台命令立即返回；自然完成自动唤醒；kill 静默；session shutdown 无残留进程；`/reload` 后任务仍可查询和停止。

## 证据

- README：`packages/pi-background-terminal/README.md`
- 当前实现：`packages/pi-background-terminal/src/`
- 讨论：`codestable/talks/004-background-terminal-redesign.md`
- 历史：`codestable/issues/025-x-background-terminal-package.md`、`codestable/issues/037-x-background-terminal-tool-selection.md`、`codestable/issues/038-x-background-terminal-bash-override-redesign.md`
- 独立工具版本：`codestable/issues/039-x-background-terminal-standalone-tools.md`
- 生命周期与菜单：`codestable/issues/042-x-background-terminal-menu-lifecycle.md`
- 自动发布：`.github/workflows/release.yml`

# pi-background-terminal

## 这一层是什么

`@bytetrue/pi-background-terminal` 提供三个完全独立的 Agent 工具：在后台运行一个命令、查看它、停止它；另提供用户用的 `/background` 菜单管理当前 session 的任务。**不覆盖 `bash`，不注册任何与 Pi 原生工具同名的 tool，不影响内建 `bash` 的任何行为。**

Peer：`@earendil-works/pi-coding-agent` `>=0.79.10`。npm `latest`：`0.3.0`。

## 命名由来的两次纠偏

第一版自称"对齐 OpenCode"，实际对齐的是 `shekohex/opencode-pty`——一个个人开发者维护的第三方社区插件，OpenCode 官方核心没有任何后台/PTY 工具。第二版吸取教训不再对齐任何产品，改为覆盖内建 `bash` 加一个 `background` 参数（+`bash_output`/`bash_kill`）。用户验收后提出两点新要求，促成第三版（当前版本）：

1. **不想覆盖 `bash`，不想影响 Pi 原生工具**——哪怕覆盖在技术上无害（不改变原生行为、不绕开不存在的权限系统），用户仍然不想要这种耦合方式，改为三个完全独立命名的工具。
2. **输出应该落盘**，理由是**上下文管理**而非"进程重启幸存"：命令输出可能很长，如果整段塞进 agent 上下文容易撑爆；落盘后 agent 可以用已有的 `read` 工具选择性地看。

## 它负责什么

- **`background_run(command, timeoutSeconds?)`**：立即返回任务 id 与输出文件路径；命令通过 Pi 自己的本地 shell backend（`createLocalBashOperations`）继续跑。`timeoutSeconds` 可选：提供时复用 Pi 内建 bash 工具本身的超时校验与跨平台进程树 kill（Windows `taskkill /F /T`，POSIX 进程组 `SIGKILL`），到时自动终止，状态记为 `timed_out`；省略时不限时，直到命令自然退出或 session 清理。显式提供的值仍由 `manager.start()` 运行时守卫校验。
- **输出落盘**：命令的 stdout/stderr 实时写入 `$TMPDIR/pi-background-terminal/<task-id>.log`；工具本身只维护一个小型内存 tail 预览（约 4000 字符）与累计行数，不重复实现 offset/limit 分页——需要看更多，直接用 Pi 内建 `read` 工具读那个文件路径。
- **`background_status(id?)`**：不传 id 列出所有后台任务（id/command/status/输出文件路径）；传 id 看该任务详情（状态、退出码或超时、输出文件路径、行数、tail 预览、"用 read 工具看全部"提示）。
- **`background_kill(id)`**：手动提前停止一个仍在运行的任务；已结束的任务返回友好提示而不报错；主动停止不发送自动完成 follow-up。
- **`/background`**：用户菜单列出当前 session 的任务；进入任务后可查看落盘输出、确认停止运行中的任务或返回，不需要记 `list` / `kill` 或复制 id。
- **自动完成通知**：任务自然退出或超时后，通过 `pi.sendMessage(..., {deliverAs:"followUp", triggerTurn:true})` 自动唤醒发起它的 Pi session 继续对话；主动 `background_kill` 和 session 清理不发送通知——这不是"发个消息给人看"，而是 Pi 明确设计用来在 agent 空闲时立即触发下一轮 LLM 调用的机制；`display:true` 只是顺带让人类也能在 TUI 里看到。
- **会话隔离与清理**：任务按 `parentSessionId` 隔离；真正的 session 结束（quit/新会话/切换/fork）时等待并清理该 session 所有仍在跑的进程树与输出流，再删除对应输出文件；`/reload` 不算结束，任务原样保留（详见下文）。

## 它不负责什么

- 不覆盖、不注册任何与 Pi 内建工具同名的 tool；`bash` 的行为、渲染、未来变化都不受此包影响。
- 不是 PTY / 伪终端；没有原生依赖，不支持交互式输入（没有类似 `pty_write` 的工具）——需要交互的任务应在真实终端里跑，这不是本包要解决的问题。
- 不做常驻 daemon、Web UI、远程面板、tmux。
- 输出文件没有应用层大小上限：`timeoutSeconds` 兜住命令运行时长，Pi 内建 `read` 工具自身的截断（50KB/2000 行）兜住单次阅读量，足够，不重复造轮子。
- 不做自定义 `workdir`/`env` 参数——命令总是在当前 Pi session 的 cwd 下跑，需要更灵活的场景不在范围内。

## 统一语言

- **background task**：一次 `background_run` 调用产生的后台命令；有稳定 `bg_<hex>` id、状态（`running`/`exited`/`killed`/`timed_out`/`failed`）、输出文件路径、父 Pi session。
- **timed_out**：因达到 `timeoutSeconds` 被 Pi 内部机制自动终止，区别于用户主动 `background_kill` 产生的 `killed`。
- **failed**：命令根本没跑起来或没能产生退出码（cwd 不存在、这台机器上没有可用 shell、timeout 超出 Pi 上限）。与 `exited` 分开，避免把「从未运行」谎报成「退出码 null」。
- **parent Pi session**：发起该任务的 Pi session；`get`/`list`/`kill`/`clearSession` 都按它隔离。
- **自动唤醒**：任务结束时给原 session 发一条 `followUp` + `triggerTurn:true` 消息，让空闲的 agent 立即开始新一轮对话，不要求 agent 轮询 `background_status`。

## `/reload` 安全性

Pi 的 `/reload` 会在**同一个 session** 上重新触发 `session_shutdown`（`reason:"reload"`）再 `session_start`（`reason:"reload"`），这只是扩展/配置热重载，不是会话真正结束（核实自 Pi `agent-session.js` 源码：`reload()` 方法只重建 extension runtime，从不创建新 session）。`session_shutdown` handler 在 `event.reason === "reload"` 时直接跳过清理；只有 `quit`/`new`/`resume`/`fork` 才会清空任务、删除输出文件。这条是第二版实现时被独立 review 抓到的真实 blocker，第三版原样继承了这个修复。

## 使用路径

| 想完成的事 | 入口 |
|---|---|
| 普通命令，跑完就有结果 | 内建 `bash`，本包不参与 |
| 起一个要越过本次工具调用继续跑的命令 | `background_run(command, timeoutSeconds?)`；省略 timeout 表示不限时 |
| 看所有后台任务 / 看某一个的状态和输出文件路径 | `background_status()` / `background_status(id)` |
| 看某个后台任务的完整或大量输出 | Pi 内建 `read` 工具，读 `background_status` 给的输出文件路径 |
| 提前停掉一个后台任务 | `background_kill(id)` |
| 用户查看、看输出、停止或返回 | `/background` 菜单，不需要输入命令或 id |
| 发 npm 版 | push tag `pi-background-terminal-v<version>`，由 repo `release.yml` + npm Trusted Publishing 自动发布 |

## 子系统地图

```text
Extension entry (index.ts)
  ├─ tools/background-run.ts     启动；委托 background/manager.ts
  ├─ tools/background-status.ts  列表 / 单任务详情（含输出文件路径 + tail 预览）
  ├─ tools/background-kill.ts    手动停止
  ├─ background-command.ts       `/background` 用户菜单、输出查看与返回
  └─ background/manager.ts
       ├─ createLocalBashOperations().exec()  ← 复用 Pi 自己的本地 shell backend（含 timeout 校验、跨平台 kill）
       ├─ fs.createWriteStream()              ← 输出实时写入 $TMPDIR/pi-background-terminal/<id>.log
       └─ globalThis[Symbol.for(...)]         ← 进程级单例，跨 /reload 的模块重新求值存活
```

完成通知不注册自定义 renderer：Pi 对 custom message 的默认渲染已经给出带主题色的 `[background-exit]` 标签 + 盒装 Markdown 正文，自己写 renderer 反而更丑、更多代码。

## 架构考量

- **不对标任何外部产品**：三次重设计后的最终形态，只解决用户点名的四件事（跑/查看/管理/通知），不因为某个产品这么做就跟着做——即便某个选择恰好和别的产品殊途同归（例如落盘输出、复用通用 `read` 工具，与 Claude Code 现行设计的方向一致），也是各自独立推导出的结论，不是对齐。
- **复用 Pi 官方扩展点与工具，不重新发明**：`createLocalBashOperations()`（跨平台 shell 执行、timeout、进程树 kill）与 Pi 内建 `read` 工具（大文件截断、offset/limit）都是公开、文档化、已被验证过的能力；本包只负责"什么时候该跑在后台"这一层胶水逻辑。
- **完全不碰 Pi 原生工具身份**：三个工具都是独立命名，`bash` 的注册、渲染、未来任何版本变化都不受影响，避免了覆盖同名工具带来的任何潜在耦合。
- **落盘而不是内存 buffer 的具体动机是上下文控制**：避免"查看"类工具的返回值随命令输出量线性增长，把"要不要看更多"的决定权交给 agent 自己通过 `read` 工具的 offset/limit。
- **`timeoutSeconds` 可选**：显式提供时把命令不会失控卡死交给 Pi 框架兜底；省略时支持长驻开发服务，但真正 session 结束仍由 session-scoped 清理硬停止，保持安全边界。
- **`/reload` 安全**：`session_shutdown` 按 `reason` 精确区分热重载与真正结束，避免后台任务被无声杀死。

## 当前边界

**做**
- `background_run` / `background_status` / `background_kill` 三个独立工具
- `/background` 用户菜单：按 session 列出任务，进入后查看输出、确认停止或返回
- 输出实时落盘，内存只保留小型 tail 预览
- 显式提供 `timeoutSeconds` 时自动终止 + 手动 `background_kill`；省略 timeout 表示不限时
- 自然完成/超时自动唤醒 agent；主动 kill 与 session 清理静默
- session-scoped 清理（`/reload` 安全）：等待真实进程树与输出流完成后删除输出文件

**不做**
- 覆盖或影响任何 Pi 原生工具
- PTY / 交互式 stdin
- Web UI / 远程面板 / tmux / 常驻 daemon
- 自定义 `workdir`/`env`、输出文件应用层大小上限

## 证据索引（按需）

- 包 README：`packages/pi-background-terminal/README.md`
- 入口：`packages/pi-background-terminal/src/index.ts`
- 任务管理：`packages/pi-background-terminal/src/background/manager.ts`
- 讨论记录：`.cs/talks/004-background-terminal-redesign.md`
- Pi 官方扩展点：Pi `docs/extensions.md`（`pi.sendMessage` 的 `deliverAs`/`triggerTurn` 语义、`session_shutdown` 的 `reason` 字段）
- 历史（已被本次重写取代）：`.cs/issues/025-x-background-terminal-package.md`（第一版 PTY）、`.cs/issues/037-x-background-terminal-tool-selection.md`（第二版文案调优）、`.cs/issues/038-x-background-terminal-bash-override-redesign.md`（第二版覆盖 bash）
- 当前独立工具实现：`.cs/issues/039-x-background-terminal-standalone-tools.md`
- 不限时、生命周期清理与 `/background` 菜单实现/验证：`.cs/issues/042-x-background-terminal-menu-lifecycle.md`
- 自动发布工作流：`.github/workflows/release.yml`

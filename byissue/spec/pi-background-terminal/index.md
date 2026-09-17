# pi-background-terminal

## 定位

`@bytetrue/pi-background-terminal` 提供纯后台命令执行：`background_run(command, timeout?)` 立即返回 task id，命令自行运行，退出时自动唤醒 Agent。内建 `bash` 是前台执行器（原生，零触碰，仅 600s 安全网 hook）；本包的工具**没有任何前台等待能力**。选择轴是"要不要结果"——模型自己的知识，不是时长预测：

- 需要输出才能继续 → `bash`（阻塞拿结果）
- 应该脱手跑（build/测试套件/dev server/watch）→ `background_run`（立即返回 + 退出唤醒）

Peer：`@earendil-works/pi-coding-agent >=0.80.5`。

决策链：039（三独立工具，不覆盖）→ 071（翻转：覆盖 bash + waitSeconds）→ 077（覆盖上双默认）→ 078（翻转回不覆盖，`run` 工具带 wait-then-demote）→ **079（定调：纯后台专注，删除全部等待路径，恢复 `background_run` 诚实名）**。077/078 的机制遗产保留：600s 默认寿命、50MiB 文件上限、agent-bin PATH、PI_* 环境、进程同生共死。

## 当前表面

### background_run（纯后台）

- `background_run(command, timeout?)`：schema 自定义（timeout 上限 2147483 对齐内建）；立即返回 `Started in background: <id> / Output file: <path> / Hard timeout: Ns. You will be notified when it exits; until then the output file is partial.`。
- **`timeout` 缺省 600s**（总寿命硬杀；`timed_out` 可观测并入通知）；dev server 逃逸口写在 description（"pass a larger value like 86400"）。
- **无等待路径**：不内联返回输出、无 waitSeconds、无 demote 竞态。print/JSON 会话无需特判——fire-and-forget 在所有 mode 行为一致，任务随进程死。
- 尊重用户 `shellPath`/`shellCommandPrefix`（`SettingsManager.create`，尊重项目信任态，损坏 fail-open）；注入 `PI_*` 会话环境 + agent-bin PATH 前置（复刻内建 `getShellEnv()` 语义；上游导出后切换——upgrade trigger 在代码注释）。
- promptGuidelines 五条引导，按 decision 001 正向优先措辞：hands-off → background_run；need the result now → bash；启动后继续做别的或结束回合，退出以新消息开启下一回合（"that notification is how you wait"），`background_status` 只用于一次性查看部分输出；dev server 传大 timeout；bash/powershell 无 timeout 时被 600s 硬杀（本扩展注入），需要更长命令的结果就给 bash 传更大 timeout（不是转 background_run）。返回文本同样以动作收尾（continue with other work or end your turn now）。`timed_out` 唤醒消息附带恢复提示；background_status 运行中任务的 tail 标注 "still running"（防部分输出误读）。

### 后台管理

- `background_status(id)`：状态、退出码、输出文件路径、行数、约 4000 字符 tail；全量阅读交给内建 `read`。
- `background_kill(id)`：停止运行中任务；主动停止静默（无 follow-up）。
- `/background`：仅面向用户的菜单；footer `bg:N` 显示运行数。
- 通知：命令自然退出/失败/超时 → `followUp + triggerTurn:true` 唤醒空闲 Agent；忙碌期缓冲到 `agent_settled` 合并为一条。

### 600s 默认超时 hook（bash + powershell）

内建 shell 工具不传 timeout 时经 `tool_call` 钩子注入 600s——防跑飞命令挂死 agent。不注册工具、不接管执行，只补默认值（065 原设计）。

## 输出与生命周期

- stdout/stderr 实时写 `$TMPDIR/pi-background-terminal/<id>.log`；内存只留 tail 预览与行数。
- **输出文件 50 MiB 上限**：到量停写 + 截断标记（含丢弃字节数），任务照常跑完。
- 状态 `running | exited | killed | failed | timed_out`。
- **进程同生共死不变式**（实测）：任务经 `ops.exec()` spawn 即进 Pi 的 tracked 集合；正常退出、SIGTERM/SIGHUP、uncaughtCrash、emergencyTerminalExit、print 退出全路径必杀。唯一例外：命令自行 daemonize（nohup/setsid）与 SIGKILL——内建 bash 同样无解。任务按 `parentSessionId` 隔离；`/reload` 存活（manager 钉 `globalThis[Symbol.for(...)]`）。
- **崩溃日志兜底**：崩溃路径留孤儿日志；加载时扫除 mtime > 24h 的 `bg_*.log`，跳过 live 任务，逐文件 fail-soft。
- manager 已删除全部等待路径（runWithWait/oneShot/inlineResult/readTail）——纯后台包，无死代码。

## 明确不做

- 覆盖、注册同名或以任何形式接管任何内建工具（除 600s 输入注入 hook）；
- **前台等待/内联返回输出**（bash 的职责；071/078 的 wait-then-demote 已按 079 决策删除）；
- PTY、交互式 stdin、tmux、daemon、Web UI；
- 可配置默认值（600s / 50 MiB 固定）；
- 自定义 workdir/env 参数；
- 输出文件滚动/轮转；
- 自制 shell backend、输出分页或文件查看工具；
- Pi 退出后的进程持久化。

## 使用路径

| 目的 | 入口 |
|---|---|
| 需要结果才能继续（含慢命令） | 内建 `bash`（阻塞，600s hook 兜底） |
| 脱手跑（build/测试套件/长任务） | `background_run(command)`（600s 默认寿命） |
| dev server / watch mode | `background_run(command, timeout: 86400)` |
| 查看一个后台任务 | `background_status(id)` |
| 阅读完整输出 | `read` 读取返回的文件路径 |
| 停止一个任务 | `background_kill(id)` |
| 用户浏览管理 | `/background` |
| 发布 | tag `pi-background-terminal-v<version>` |

## 实现地图

```text
src/index.ts
  ├─ tools/background-run.ts     background_run：600s 默认寿命 + sessionEnv（agent-bin PATH）
  ├─ tools/background-status.ts
  ├─ tools/background-kill.ts
  ├─ bash-default-timeout.ts     bash/powershell 600s 注入 hook（安全网）
  ├─ background-command.ts       /background 菜单
  └─ background/manager.ts
       ├─ spawn                  exec + 输出文件（50MiB 上限）+ 通知编排
       ├─ createLocalBashOperations({shellPath})
       ├─ sweepOrphanLogs()      加载时年龄扫描（跳过 live 任务）
       └─ globalThis[Symbol.for(...)]
```

## 验证

```bash
npm --workspace @bytetrue/pi-background-terminal test
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm --workspace @bytetrue/pi-background-terminal pack --dry-run
```

真实 Pi 回归还应确认：快命令落在原生 bash；需要结果的慢命令落在 bash；hands-off 场景落在 background_run 且唤醒链路完整（退出码+末行）；dev server 逃逸口模型自主传大 timeout；SIGTERM 杀 pi 进程后台任务同死；`/reload` 后任务可见可停；无新孤儿日志。

## 证据

- README：`packages/pi-background-terminal/README.md`
- 纯后台定调：`byissue/issues/079-x-bg-terminal-pure-background.md`（含验证与变异记录）
- 解耦翻转：`byissue/issues/078-x-bg-terminal-decouple-run-tool.md`
- 双默认/one-shot/文件上限/PATH 复刻机制：`byissue/issues/077-x-bg-terminal-dual-defaults.md`
- 单入口设计与"名字撒谎"批判（079 通过删除快路径使其失效、恢复诚实名）：`byissue/talks/005-background-terminal-bash-waitseconds.md`
- 历史链：039 → 071 → 077 → 078 → 079；`byissue/talks/004-background-terminal-redesign.md`
- 默认超时注入：`byissue/issues/065-x-ff-bash-default-timeout.md`
- 自动发布：`.github/workflows/release.yml`

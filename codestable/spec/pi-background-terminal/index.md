# pi-background-terminal

## 定位

`@bytetrue/pi-background-terminal` 的核心是**一个统一的命令执行入口**：覆盖内建 `bash`，加一个可选 `waitSeconds` 参数——命令在等待期内退出就内联返回（与内建逐字节同形），超期自动转后台并在退出时唤醒 Agent。模型不再需要预测命令时长来选工具，只决定愿意阻塞多久。

Peer：`@earendil-works/pi-coding-agent >=0.80.5`。

## 当前表面

### bash 覆盖（waitSeconds 语义）

- `bash(command, timeout?, waitSeconds?)`：schema 从 `createBashToolDefinition()` 运行时组合追加一参数；不传 `waitSeconds` 时**纯委托内建 execute**（含 600s 默认超时注入，见下）；promptSnippet/promptGuidelines/label 显式携带（override 不继承）；renderCall/renderResult 省略，按槽位回退内建渲染器。
- `waitSeconds: 0` → 立即转后台（收编原 `background_run`）；`N > 0` → 同步竞态：期内退出内联返回（`truncateTail` 截断 + 内建同款三种 footer + 非零退出/超时/abort 的错误形状），超期转后台返回 task id + 输出文件路径。
- `timeout` 语义为**总寿命硬杀**：设了就到点必死（转后台后以 `timed_out` 状态可观测并入通知）；不设则后台任务不限寿命。
- 等待期 abort（Esc）：静默杀任务 + 抛 `Command aborted`（带已产出输出），无后续唤醒——与内建 abort 同形。
- 委托与 wait 路径都尊重用户 `shellPath`/`shellCommandPrefix`（经 `SettingsManager.create(cwd, undefined, {projectTrusted})` 读同一批文件，按 ctx 信任态决定项目层是否生效，损坏 fail-open）；wait 路径注入与内建相同的 `PI_*` 会话环境。已知边界：base env 未复刻内建的 agent-bin PATH 前置（不可导出；upgrade trigger 在代码注释）。
- **powershell 不覆盖**：extension 注册的工具会被 `includeAllExtensionTools: true` 强制激活，而 powershell 在所有平台默认 active 集都不含——覆盖它会在 macOS/Linux 凭空多一个工具。600s hook 仍按名覆盖它。

### 后台管理

- `background_status(id)`：状态、退出码、输出文件路径、行数、约 4000 字符 tail；全量阅读交给内建 `read`。
- `background_kill(id)`：停止运行中任务；主动停止静默（无 follow-up）。
- `/background`：仅面向用户的菜单；footer `bg:N` 显示运行数。
- 通知：命令自然退出/失败/超时 → `followUp + triggerTurn:true` 唤醒空闲 Agent；忙碌期缓冲到 `agent_settled` 合并为一条；被等待过的任务抑制默认通知（内联结果已是结局），转后台时经 `notified` 标志重新武装，保证竞态下恰一次。

### 默认超时注入

`tool_call` 钩子对未传 `timeout` **且未传 `waitSeconds`** 的 shell 调用注入 `timeout: 600`；显式 timeout 原样尊重；waitSeconds 调用跳过（降级的 dev server 不能被默认值杀死）。

## 输出与生命周期

- stdout/stderr 实时写 `$TMPDIR/pi-background-terminal/<id>.log`；内存只留 tail 预览与行数。
- 状态 `running | exited | killed | failed | timed_out`；`timed_out` 依赖 `ops.exec` 原生 `timeout:N` 拒绝识别，与 killed/failed 可区分。
- 内联读取有 2 MiB 上限（防病理性输出 OOM 宿主），超限读尾部并以跟踪行数修正 totalLines。
- 任务按 `parentSessionId` 隔离；`/reload` 存活（manager 钉 `globalThis[Symbol.for(...)]`）；真实 session 结束等待进程树与输出流后删文件。
- **崩溃路径兜底**：Pi 的 `uncaughtCrash`/`emergencyTerminalExit` 只杀进程不 fire session_shutdown，会留孤儿日志；extension 每次加载（启动 + `/reload`）扫除 mtime > 24h 的 `bg_*.log`，跳过本 manager 持有的任务输出文件，逐文件 fail-soft。跨进程的静默任务（>24h 无输出）可能被另一实例清掉——接受（OS 对 $TMPDIR 的清理迟早也会）。

## 明确不做

- 覆盖 `powershell` 或任何其它内建工具（理由见上）；
- PTY、交互式 stdin、tmux、daemon、Web UI；
- 可配置默认超时值（固定 600 秒）；
- 自定义 workdir/env 参数（PI_* 会话环境由工具自动注入）；
- 自制 shell backend、输出分页或文件查看工具；
- Pi 退出后的进程持久化。

## 使用路径

| 目的 | 入口 |
|---|---|
| 普通命令，等待结果（默认 600s 超时） | `bash(command)` |
| 想要结果但别卡死 | `bash(command, waitSeconds: N)` |
| dev server / watch mode | `bash(command, waitSeconds: 0)` |
| 查看一个后台任务 | `background_status(id)` |
| 阅读完整输出 | `read` 读取返回的文件路径 |
| 停止一个任务 | `background_kill(id)` |
| 用户浏览管理 | `/background` |
| 发布 | tag `pi-background-terminal-v<version>` |

## 实现地图

```text
src/index.ts
  ├─ tools/shell-override.ts      bash 覆盖：schema 组合 + 委托/waitSeconds 分派 + sessionEnv
  ├─ tools/background-status.ts
  ├─ tools/background-kill.ts
  ├─ bash-default-timeout.ts      tool_call 钩子：600s 注入（waitSeconds 跳过）
  ├─ background-command.ts        /background 菜单
  └─ background/manager.ts
       ├─ spawn/runWithWait       exec + 输出文件 + 等待竞态 + 通知编排
       ├─ createLocalBashOperations({shellPath})
       ├─ sweepOrphanLogs()       加载时年龄扫描（跳过 live 任务）
       └─ globalThis[Symbol.for(...)]
```

## 验证

```bash
npm --workspace @bytetrue/pi-background-terminal test
npm --workspace @bytetrue/pi-background-terminal run typecheck
npm --workspace @bytetrue/pi-background-terminal pack --dry-run
```

真实 Pi 回归还应确认：Shell 工具列表仅 bash；普通命令行为不变；waitSeconds 快路径内联/慢路径转后台+通知；timeout 硬杀 `timed_out`；abort 杀任务无唤醒；`/reload` 后任务可见可停；无新孤儿日志。

## 证据

- README：`packages/pi-background-terminal/README.md`
- 设计论证：`codestable/talks/005-background-terminal-bash-waitseconds.md`
- 主变更：`codestable/issues/071-x-background-terminal-bash-waitseconds.md`（含 review 轮记录）
- 孤儿清理：`codestable/issues/072-x-background-terminal-orphan-log-cleanup.md`
- 历史：`codestable/issues/039-x-background-terminal-standalone-tools.md`（本 issue 翻转其「不覆盖 bash」决策）、`codestable/talks/004-background-terminal-redesign.md`
- 默认超时注入：`codestable/issues/065-x-ff-bash-default-timeout.md`
- 自动发布：`.github/workflows/release.yml`

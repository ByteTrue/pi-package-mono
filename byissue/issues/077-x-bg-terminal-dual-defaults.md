---
kind: issue
title: "双默认：waitSeconds 默认 10s + timeout 默认 600s 总寿命"
type: feature
closed: 2026-09-14
status: closed
superseded_by: byissue/issues/079-x-bg-terminal-pure-background.md
created: 2026-09-14
---

# 双默认：waitSeconds 默认 10s + timeout 默认 600s 总寿命

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。

## 做成以后是什么样

模型调用 `bash(command)` **什么都不传**时，不再是纯委托阻塞：默认等待 10 秒——期内退出内联返回，超期自动转后台并在退出时唤醒 agent；命令总寿命被默认 600 秒硬杀（含后台段），死时以 `timed_out` 状态可观测并入通知。懒模型（从不传可选参数的大多数）自动落在 wait-then-demote 统一路径上；聪明模型仍可显式调参：`waitSeconds: 0` 立即脱手、大 `waitSeconds` 更耐心、大 `timeout`（如 dev server 传 86400）逃逸寿命上限。

**范围：** bash override 的默认值语义翻转（双注入）；600s hook 缩为 powershell 专属；agent-bin PATH 复刻；输出文件上限；print/子代理会话的一步等待（no-demote）模式。**不包含：** 交互式 stdin/PTY、powershell 覆盖（维持不覆盖决策）、可配置默认值。

**归属：** 独立 issue。相关 spec：`byissue/spec/pi-background-terminal/index.md`；前序：071（单入口架构，本 issue 只翻参数默认值，不动架构）；讨论：本会话 2026-09-14（用户对"可选参数从不被使用"的实证追认 + 双默认设计确认 + 两个风险项授权解决）。

## 为什么现在做 / 当前坏在哪

- **实证（2026-09-14 扫描真实 session）**：安装 0.7.0 后，9/11–9/14 的工作会话共 133 次 bash 调用，**0 次**自发传 `waitSeconds`。懒参数是常态（Codex #6715 同病）；opt-in 的 waitSeconds 在真实使用里等于没装。
- 用户判断：默认超时（safety）也必须保留——dev server 场景是少数，大部分时候要防的是"莫名其妙的命令长时间执行"。
- Codex 现行源码（2026-09-14 核实，`codex-rs/core/src/tools/handlers/unified_exec.rs`）：`yield_time_ms` 带 **serde default = 10_000ms**，clamp 250ms–30s。Codex 没有解决"模型怎么选"，是**消灭了选择**——默认值把懒模型吸收进统一路径。本 issue 采纳同构设计。

## 现状怎么工作

`bash(command, timeout?, waitSeconds?)`：省略 waitSeconds → 纯委托内建（无超时，065 hook 注入 600s）；0 → 立即后台；N>0 → 同步竞态。`timeout` 仅在显式传入时成为总寿命硬杀。600s hook 对带 waitSeconds 的调用跳过注入（防 demote 的 dev server 被默认值杀死）。wait 路径 env 用 `process.env` + PI_*，未复刻内建 bash 的 agent-bin PATH 前置（`getShellEnv()`，`dist/utils/shell.js:115`，未从包入口导出）。

## 方案与实现安排

### 1. 双默认注入（override 自管，hook 退役）

- `waitSeconds` 缺省 → 等 10s；`timeout` 缺省 → 600s 总寿命。两者在 override 的 execute 里实现（不再依赖 tool_call hook，bash 上没有"跳过注入"的交叉逻辑了）。
- **schema description 必须写明默认值与逃逸口**（"Defaults to 10s wait / 600s total lifetime. Pass a large timeout (e.g. 86400) for dev servers and watch modes."）——模型看得到才会用。
- 600s hook 缩为 powershell 专属（powershell 不被覆盖，hook 按名注入仍是唯一路径）。
- 纯委托路径消失：所有 bash 调用走 `runWithWait`。内联返回三形（footer/错误形状/abort）071 已复刻并有变异验证，风险低。

### 2. agent-bin PATH 复刻（原"upgrade trigger"升级为必做）

内建 bash 经 `getShellEnv()` 把 `~/.pi/agent/bin`（managed fd/rg）前置到 PATH；今天只有从不被使用的 wait 路径缺失，翻转后影响所有命令，必须补齐：

- 方案 A（优先）：`import { getBinDir } from` pi 的 `config.js` 子路径——**不可行**，包 exports 只暴露 `.`、`./rpc-entry`、`./client`、`./experimental/plugin`。
- **方案 B（采纳）**：本地复刻 `getShellEnv` 语义：`join(homedir(), ".pi", "agent", "bin")` 前置到 PATH（尊重 `PI_CODING_AGENT_DIR` env 覆盖，用 `delimiter` 拼接、查重后前置——照抄 `dist/utils/shell.js:115-126` 的六行逻辑），与 `sessionEnv` 的 PI_* 合并。peer 下限不变（不新增 API 依赖）；上游若导出 `getShellEnv` 再切换，代码注释留 upgrade trigger。

### 3. 输出文件上限（防病态输出写爆磁盘）

`yes` 类命令跑满 600s 能写几十 GB。给后台任务的输出文件加上限（建议 50 MiB，常量）：到达后停止追加写入、在文件尾写一行截断标记（含丢弃字节数）、任务照常跑完——**不做**滚动/轮转（YAGNI），tail 预览与行数计数继续工作（appendTail 已是内存尾部环形，只需同步停写）。

### 4. print / 子代理会话的一步等待（no-demote）模式

**问题**：demote+唤醒依赖 `followUp + triggerTurn`，而 print 模式（`pi -p`，含 pi-subagent 的 `--mode json` 子进程）prompt 完成后立即 `disposeRuntime` 走人——转后台的任务退出时通知无人消费，且 session_shutdown 清理会杀掉还在跑的任务，浪费已跑的进度。

**方案**：execute 时检测非交互模式（`ctx.mode === "print" || ctx.mode === "json"`，`ExtensionMode` 从包入口已可导入），走 **one-shot 等待**：不 demote，直接等命令完成或 timeout 硬杀（Codex `ExecCommandLifetime::OneShot` 同构——print 会话的"后台"没有意义，等待就是唯一出路）。abort/timeout 语义不变。这同时覆盖 pi-subagent 子进程（`--mode json`）与用户手跑的 `pi -p`。

### 风险与穿刺

| 风险 | 处置 |
|---|---|
| 所有命令失去纯委托（行为分叉面变大） | 内联返回形状 071 已锁定单测 + 变异验证；真实 Pi 回归对照 |
| PATH 复刻与内建有细微分叉（如未来内建改 env 逻辑） | 代码注释留 upgrade trigger；回归测一个 `fd`/`rg` 在裸 PATH 下不可用、agent-bin 下可用的命令 |
| 10s 默认对慢命令多一轮 LLM turn | wall-clock 无损（机制本意）；真实回归确认唤醒链路 |
| one-shot 模式等 600s 阻塞 subagent | 与今天 subagent 里 bash 阻塞 600s 行为一致，不是回归 |

## 质量承诺

- 兼容性/隔离性：显式参数的行为与 071 语义完全一致；powershell 不受影响。
- 功能正确性：双默认注入、PATH 前置、文件上限截断标记、print 模式 no-demote 各有单测锁定。
- 性能效率：快命令（<10s）内联返回，零轮询不变。
- 可维护性：bash 的默认值逻辑集中在 override 一处；hook 只剩 powershell。

## 验证

- 单测：默认调用（不传任何可选参数）走 runWithWait(waitMs=10s, timeout=600s)；显式传参覆盖默认；PATH 前置正确且查重；输出超限后文件停写 + 截断标记 + tail/行数继续正确；print 模式 no-demote（等完成，不转后台，不依赖通知）；现有 51 测试全绿。
- 真实 Pi 非交互回归（自然语言不提示工具名）：普通快命令内联返回（与今天无感差别）；>10s 命令自动转后台 + 退出唤醒；`pi -p` 里跑 >10s 命令一步等到完成（不转后台不丢结果）；dev server 场景模型显式传大 timeout（验证 schema 描述的逃逸口生效）；agent-bin 依赖命令（fd/rg）在 wait 路径可用。
- `npm pack --dry-run` 干净；全仓 typecheck + test。

## 执行记录

### 2026-09-14 实现

- `src/tools/shell-override.ts`：双默认在 execute 内解析（`waitSeconds ?? 10`、`timeout ?? 600`），纯委托路径删除；schema waitSeconds 描述与工具 description 写明默认值与 dev-server 逃逸口；`oneShot = ctx.mode === "print" || "json"` 分派；`sessionEnv` 增加 agent-bin PATH 前置（复刻 `getShellEnv()` 六行语义，尊重 `PI_CODING_AGENT_DIR`）。
- `src/background/manager.ts`：`runWithWait` 增加 `oneShot` 选项（不 demote，等完成/硬杀后内联返回，abort 同形）；输出文件 50 MiB 上限（到量停写 + 截断标记含丢弃字节数，tail 预览与行数继续工作）；one-shot 任务 `suppressNotify`。
- `src/bash-default-timeout.ts`：hook 缩为 powershell 专属（bash 不再触碰，waitSeconds 跳过逻辑删除）。
- 测试：51 → 59（新增：默认 10s demote、显式 timeout 覆盖、PATH 前置（刺 host PATH 隔离测法）、print/json one-shot 等待、one-shot 硬杀、文件上限与截断标记；改写：默认路径从“纯委托无任务”变为“默认 wait 路径”，hook 测试改为 powershell 语义）。

### 2026-09-14 变异验证（四项全杀）

- 默认 wait 移除（10→0）→ 2 测试红；oneShot 置 false → 2 红；PATH 前置移除 → 1 红（初版测试因 host PATH 已含 bin 目录而漏杀，改为刺 host `process.env.PATH` 后修复）；文件上限移除 → 1 红。恢复后全绿。

### 2026-09-14 真实 Pi 回归（0.85.1，bytetrueapi/glm-5.3-flash，自然语言不提示工具名/参数）

- 快命令（`echo`）：懒调用裸 bash，内联返回，无感差别。
- 慢命令（`sleep 15`，RPC 模式）：懒调用 → 10s 后自动 demote，返回 task id + 输出文件；模型自主用 `background_status` 查询拿到结果，并向用户正确解释了机制；退出通知唤醒链路确认（custom message 触发新 turn）。
- 慢命令（`pi -p` print 模式）：懒调用 → one-shot 等到完成，内联返回 `slow-done`，不 demote、无残留任务。
- timeout 硬杀（`sleep 300` + `timeout: 4`）：内联 `Command timed out after 4 seconds`，与内建同形。
- dev server 逃逸口（"survive beyond default lifetime, don't block"）：模型无提示自主选择 `timeout: 86400 + waitSeconds: 0`，进程活满 12s 自然退出，exit 0 + 通知确认。
- typecheck 0 错；59 测试全绿；pack 10 文件干净。

## 关闭时

- 回写：`byissue/spec/pi-background-terminal/index.md` 全文重写（双默认语义、one-shot、文件上限、PATH 复刻、powershell 专属 hook）；README 使用路径与默认值说明更新。✅ 已完成。
- 关闭判断：双默认在真实 Pi 回归中被自然触发（懒调用自动 demote、模型自主使用逃逸口）。✅ 已验证。

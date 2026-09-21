# pi-subagent

## 定位

`@bytetrue/pi-subagent` 提供三个轻量工具(`subagent` / `subagent_status` / `subagent_stop`)以及用户配置命令 `/subagent`:在隔离的子进程会话中执行特定子任务、代码审查或探索性工作。一次调用 = 一个 subagent;并行 = 模型在同一条消息里发多个 `subagent` 调用(095)。

它不依赖任何外部框架或 Python 脚本，采用纯 TypeScript 实现，通过 Pi 原生 CLI 启动子进程并流式解析 JSON 事件。

## 当前表面

- `subagent(params)`:
  - `task`(必填)：要执行的提示词。
  - `agent?` / `tools?` / `cwd?` / `resume?` / `timeoutMs?`(默认 20 分钟)/ `maxTurns?`(默认 50 轮)：单任务参数;`id?` 仍被归一化接受(手动指定 session id),但不出现在 schema。
  - **单任务语义(095)**:没有 `tasks[]`、`chain`、`prompts`、`mode`——批量与链式已删除。要同时跑多个子任务，在同一条 assistant 消息里发多个 `subagent` tool call，各自独立 id、独立 manager 记录、独立进度卡、各自回各自的完成通知；退出通知在 agent 忙时经 `pendingExits` 合并为一条。
  - Agent 工具不暴露 `model` 或 `thinking`：模型与思考强度只由用户通过 `/subagent`、settings 或 agent 模板控制；旧调用即使伪造这两个字段也会在规范化与执行时被忽略。
  - **纯后台**：调用立即返回一行 started 文本与 task id，永不阻塞父回合；完整结果经 `followUp + triggerTurn` 作为新消息开启下一回合。没有 `async` 参数——没有前台模式可以退回（issue 088，对齐 background-terminal 079 的同一逻辑：结果由通知送达，"要不要阻塞"这根轴不存在）。
  - 工具 description / promptGuidelines 按 decision 001 正向措辞说明等待方式：启动后继续做别的或结束回合，结果以新消息到达；多任务 = 同一消息多次调用，控制用 `subagent_status` / `subagent_stop`。
- `subagent_status(id)`：按 id 查一个任务——状态、耗时、当前活动(运行中工具/轮次/token/费用/模型)、最近 5 条工具调用、子会话 log 路径。**不含任务 output**(全文由完成通知送达)；description 写明完成自动通知、无需轮询。
- `subagent_stop(id)`：停止一个运行中任务。幂等(已结束返回 “is already …; nothing to stop”)；停止后照常发 “was cancelled” 通知。两工具都按 parent session 过滤,跨会话的 id 视为不存在。
- 内置角色预设（以包内 agent 文档形式提供，见 `agents/*.md`，与用户 `.pi/agents/*.md` 同一套解析，同名用户文件优先）：
  - `scout`（只读快速侦察，最低思考档，工具：`read, grep, find`）
  - `researcher`（技术与网络调研，继承父会话思考强度，工具：`read, grep, find, web_search, web_fetch`）
  - `reviewer`（代码审查与跑测，最高思考档，工具：`read, grep, find, bash`）
- `/subagent`：用户交互式命令，支持配置全局/项目默认模型与思考强度、为角色绑定模型，以及查看当前运行中与最近完成的 subagent 任务（运行中可看详细进度卡与终止；结束后可看输出）。在任何子菜单按 `Esc` 均返回上一级。
- 状态栏：有任务运行时显示 `sub:N · <agent> <elapsed> · …`,**每个运行中任务一格**(最老优先)，上限 3 个后缀 `+N more`;全部结束自动清除。

## 核心机制

1. **子进程流式通信与单任务执行**：
   - 自动解析 `pi` CLI 路径，以 `--mode json -p` 启动子进程并通过 stdin 传输指令。
   - 注入 `PI_SUBAGENT_CHILD=1` 环境变量防止嵌套递归。
   - 一次调用恰好跑一个子进程(095);并行由模型发多个 tool call 天然获得，`ProgressDetails.runs` 保留数组形状但恒为单元素。
2. **防爆门与 Pi 原生 Session 断点续跑**：
   - 默认 20 分钟超时与 50 轮上限；达到上限时安全暂停子进程并输出 Session ID 与恢复提示。
   - 传递 `--session-id <id>`（初次）与 `--session <id>`（恢复），无缝复用 Pi 原生标准会话存储与断点续接机制。
3. **后台执行、通知与状态栏**：
   - 每次调用注册一条任务记录到进程级 manager（`globalThis[Symbol.for(...)]`，`/reload` 存活），立即返回。
   - 任务完成时，通过 Pi 的 `followUp` 事件唤醒主会话并递交结果全文；若主模型正在响应，暂存至 `agent_settled` 时合并唤醒。
   - 不变式：退出通知 `subagent-exit` 的 `details` 必须是纯数据（`toMessageDetails()` 剥掉 `controller`/`done`/`notifyOnExit`/`progress`）——pi core 每次 LLM 调用前对会话消息做 `structuredClone`，活 Promise 会撞炸整轮（ff 073）。
   - 通知标题的任务描述由 `describeTasks()` 生成：纯文本、角色前缀、首句截断，无 ANSI。
   - 会话退出时（`session_shutdown`）中止运行中任务并清理状态栏与 ticker。
4. **进度：一份数据、两个视图**：
   - 子进程 JSON 事件流经 `runSubagent` 聚合为 `ProgressDetails`（节流 300ms），写入 manager 记录的 `progress` 字段（仅 running 期间接受更新）。
   - 状态栏读同一记录做简略显示；`/subagent → 任务 → View Progress` 是 `ctx.ui.custom` 实时视图（500ms 重绘、↑↓ 可滚、Esc 返回），用 `renderProgressCard` 渲染与旧内嵌卡同形的卡片（耗时、思考意图、最近 8 条工具调用、token/费用、错误，按宽度截断），末尾附 `⎘ session log:` + 文件路径（`$HOME` 缩写为 `~`，单独一行；放不下时按最后一个 `/` 拆成目录行 + 文件名行，不按字符硬折）。视图固定高度（16 行视口补空行）以避免残影。聊天流中不再有实时卡片，也没有 Alt+O。
   - **完整行为历史 = 子会话文件**：子 agent 是真实 pi 会话，落盘于 `<agentDir>/sessions/<cwd 编码>/<ts>_<sessionId>.jsonl`。`sessionLogPath()` 复刻 pi 未导出的目录编码规则定位它；进度卡每个 run 附文件路径；完成通知末尾附 `Session log(s)` 列表给完整路径（用户直接打开，模型需要时可 `read`）。用户明确要文件而非 `pi --session` 命令。
5. **用户控制的执行策略**：模型优先级为 `subagent.agents[x].model > agent 文档 model（`.pi/agents/x.md`、`<agentDir>/agents/x.md`、包内 `agents/x.md`，后者与内置角色是同一机制） > subagent.defaultModel > 继承父会话当前完整 provider/model（ctx → 事件追踪 → PI_PROVIDER/PI_MODEL env） > 子进程自身默认`；思考强度同链对称（角色设置 > agent 文档 > subagent 默认 > 父会话）。内置角色是包内 `agents/{scout,researcher,reviewer}.md`，与用户文档同解析、同名用户文件优先；scout 最低档（`minimal`，由 pi 按子模型能力向上夹取）、reviewer 最高档（`max`，向下夹取）、researcher 不设档随父会话。`off` 也是真实档位，会随继承传给子进程（`buildPiArgs` 不再丢弃它）。Agent 的单次 tool call 无权覆盖二者。未显式配置时不读取 pi settings 根层 `defaultProvider`/`defaultModel`/`defaultThinkingLevel`。

## 明确不做

- 前台/阻塞模式或任何 `async` 开关；
- `tasks[]` 批量、`chain` 流水线或任何多任务入参(095 已删,不回归)：并行属于模型的 tool call 层,不属于本工具的入参层；
- 聊天流内的实时进度卡与 Alt+O 展开；
- print 模式（`pi -p` / `--mode json`）下的结果回落：进程跑完一回合即退出，后台 subagent 没有下一回合可送达，结果随进程丢（与 background-terminal 079 同一取舍）。

## 使用路径

| 目的 | 入口 |
|---|---|
| 执行独立子任务 / 审查 / 探索 | `subagent({ task: "..." })` → 立即返回，结果以新消息到达 |
| 并行对比或批量处理 | 同一消息里发多个 `subagent` 调用(各自独立 id/进度/通知) |
| 查看某任务状态/活动/子会话 log | `subagent_status({ id })` |
| 中途停止某任务 | `subagent_stop({ id })`(幂等) |
| 链式多步骤流转 | 让父会话自己做编排:逐步调用、读结果、决定下一步 |
| 配置默认模型与角色映射 | `/subagent` 用户菜单 |
| 看简略进度 | 底部状态栏 `sub:N · <agent> <elapsed> · …` |
| 看详细进度 / 输出 / 停止任务 | `/subagent` → `View Active Subagents` → 任务 |
| 查看当前配置与识别的角色 | `/subagent list` 或 `/subagent show` |

## 验证

```bash
npm --workspace @bytetrue/pi-subagent test
npm --workspace @bytetrue/pi-subagent run typecheck
```

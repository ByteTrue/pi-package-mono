# pi-subagent

## 定位

`@bytetrue/pi-subagent` 提供单一轻量 Agent 工具 `subagent` 以及用户配置命令 `/subagent`：在隔离的子进程会话中执行特定子任务、代码审查或探索性工作，并带有实时的 TUI 差分进度卡片和 Token/费用统计。

它不依赖任何外部框架或 Python 脚本，采用纯 TypeScript 实现，通过 Pi 原生 CLI 启动子进程并流式解析 JSON 事件。

## 当前表面

- `subagent(params)`：
  - `tasks`（必填）：任务对象数组 `Array<{ task, agent?, tools?, cwd?, resume?, id?, timeoutMs?, maxTurns? }>`。
  - Agent 工具不暴露 `model` 或 `thinking`：模型与思考强度只由用户通过 `/subagent`、settings 或 agent 模板控制；旧调用即使伪造这两个字段也会在规范化与执行时被忽略。
  - `chain`（可选，默认 `false`）：设置为 `true` 时按顺序流水线执行（前序输出自动作为后序输入）；默认 `false` 为并发执行。
  - `timeoutMs`（可选，默认 `1200000` 即 20 分钟）：任务超时限制。
  - `maxTurns`（可选，默认 `50` 轮）：任务轮次限制。
  - **纯后台**：调用立即返回一行 started 文本与 task id，永不阻塞父回合；完整结果经 `followUp + triggerTurn` 作为新消息开启下一回合。没有 `async` 参数——没有前台模式可以退回（issue 088，对齐 background-terminal 079 的同一逻辑：结果由通知送达，"要不要阻塞"这根轴不存在）。
  - 工具 description / promptGuidelines 按 decision 001 正向措辞说明等待方式：启动后继续做别的或结束回合，结果以新消息到达。
- 内置角色预设：
  - `scout`（只读快速侦察，`thinking: low`，工具：`read, grep, find`）
  - `researcher`（技术与网络调研，`thinking: medium`，工具：`read, grep, find, web_search, web_fetch`）
  - `reviewer`（代码审查与跑测，`thinking: high`，工具：`read, grep, find, bash`）
- `/subagent`：用户交互式命令，支持配置全局/项目默认模型与思考强度、为角色绑定模型，以及查看当前运行中与最近完成的 subagent 任务（运行中可看详细进度卡与终止；结束后可看输出）。在任何子菜单按 `Esc` 均返回上一级。
- 状态栏：有任务运行时显示 `sub:N · <agent> <elapsed>`（N 为运行数，角色/耗时取最老的运行中任务），每秒刷新；全部结束自动清除。

## 核心机制

1. **子进程流式通信与并发/流水线调度**：
   - 自动解析 `pi` CLI 路径，以 `--mode json -p` 启动子进程并通过 stdin 传输指令。
   - 注入 `PI_SUBAGENT_CHILD=1` 环境变量防止嵌套递归。
   - 默认并发执行（`Promise.all`），在 `chain: true` 时顺序串行执行并传递输出；任何一步失败自动熔断。
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
5. **用户控制的执行策略**：模型优先级为 `subagent.agents[x].model > agent .md frontmatter model > subagent.defaultModel > 继承父会话当前完整 provider/model（ctx → 事件追踪 → PI_PROVIDER/PI_MODEL env） > 子进程自身默认`；思考强度同链对称（角色设置 > agent 模板 > subagent 默认 > 父会话），内置角色提供其文档化默认值。Agent 的单次 tool call 无权覆盖二者。未显式配置时不读取 pi settings 根层 `defaultProvider`/`defaultModel`/`defaultThinkingLevel`。

## 明确不做

- 前台/阻塞模式或任何 `async` 开关；
- 聊天流内的实时进度卡与 Alt+O 展开；
- print 模式（`pi -p` / `--mode json`）下的结果回落：进程跑完一回合即退出，后台 subagent 没有下一回合可送达，结果随进程丢（与 background-terminal 079 同一取舍）。

## 使用路径

| 目的 | 入口 |
|---|---|
| 执行独立子任务 / 审查 / 探索 | `subagent({ tasks: [{ task: "..." }] })` → 立即返回，结果以新消息到达 |
| 并行对比或批量处理 | `subagent({ tasks: [{ task: "1" }, { task: "2" }] })` |
| 链式多步骤流转 | `subagent({ chain: true, tasks: [...] })` |
| 配置默认模型与角色映射 | `/subagent` 用户菜单 |
| 看简略进度 | 底部状态栏 `sub:N · <agent> <elapsed>` |
| 看详细进度 / 输出 / 停止任务 | `/subagent` → `View Active Subagents` → 任务 |
| 查看当前配置与识别的角色 | `/subagent list` 或 `/subagent show` |

## 验证

```bash
npm --workspace @bytetrue/pi-subagent test
npm --workspace @bytetrue/pi-subagent run typecheck
```

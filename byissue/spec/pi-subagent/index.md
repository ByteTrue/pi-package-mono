# pi-subagent

## 定位

`@bytetrue/pi-subagent` 提供三个轻量工具(`subagent` / `subagent_status` / `subagent_stop`)以及用户配置命令 `/subagent`:在隔离的子进程会话中执行特定子任务或探索性工作。一次调用 = 一个 subagent;并行 = 模型在同一条消息里发多个 `subagent` 调用(095)。

它不依赖任何外部框架或 Python 脚本，采用纯 TypeScript 实现，通过 Pi 原生 CLI 启动子进程并流式解析 JSON 事件。

## 当前表面

- `subagent(params)`:
  - `task`(必填)：要执行的提示词。
  - `agent?` / `tools?` / `cwd?` / `resume?` / `timeoutMs?`(默认 20 分钟)/ `maxTurns?`(默认 50 轮)：单任务参数;`id?` 仍被归一化接受(手动指定 session id),但不出现在 schema。
  - **单任务语义(095)**:没有 `tasks[]`、`chain`、`prompts`、`mode`——批量与链式已删除。要同时跑多个子任务，在同一条 assistant 消息里发多个 `subagent` tool call，各自独立 id、独立 manager 记录、独立进度卡、各自回各自的完成通知；退出通知在 agent 忙时经 `pendingExits` 合并为一条。
  - Agent 工具不暴露 `model` 或 `thinking`：模型与思考强度只由用户通过 `/subagent`、settings 文件或 agent 模板控制；旧调用即使伪造这两个字段也会在规范化与执行时被忽略。
  - **纯后台**：调用立即返回一行 started 文本与 task id，永不阻塞父回合；完整结果经 `followUp + triggerTurn` 作为新消息开启下一回合。没有 `async` 参数——没有前台模式可以退回（issue 088，对齐 background-terminal 079 的同一逻辑：结果由通知送达，"要不要阻塞"这根轴不存在）。
  - 工具 description / promptGuidelines 按 decision 001 正向措辞说明等待方式：启动后继续做别的或结束回合，结果以新消息到达；多任务 = 同一消息多次调用，控制用 `subagent_status` / `subagent_stop`。同样正向说明默认路径：`agent` 省略 = 通用子 agent（继承父会话 model/thinking 与 pi 默认工具 `read, bash, edit, write`）。角色宣传经 description 内嵌的 **roster** 完成（issue 102；096/100 两轮把门槛收到「恰好匹配才用」曾是角色长期不被主动选用的原因）：`buildAgentRosterText(cwd)` 在工具注册时把全部已发现角色连同各自文档 `description:` 触发句（"Use it to…" 祈使句，写给调度模型）渲染进 description，自定义 `.pi/agents/*.md` 因此对模型可见；roster 注册时求值，会话中新增文档需 `/reload` 才进宣传面，而角色解析本身始终实时读文件。
  - `agent` 传了不存在的名字时**报错**：错误文本列出可用角色并提示可省略 `agent` 走通用子 agent，不会静默退化为通用子 agent（issue 097）。执行时经 `resolveAgentRole` 解析；settings 里显式配置过但无文档的角色名仍被接受。
- `subagent_status(id)`：按 id 查一个任务——状态、耗时、当前活动(运行中工具/轮次/token/费用/模型)、最近 5 条工具调用、子会话 log 路径。**不含任务 output**(全文由完成通知送达)；description 写明完成自动通知、无需轮询。
- `subagent_stop(id)`：停止一个运行中任务。幂等(已结束返回 “is already …; nothing to stop”)；停止后照常发 “was cancelled” 通知。两工具都按 parent session 过滤,跨会话的 id 视为不存在。
- 内置角色预设（以包内 agent 文档形式提供，见 `agents/*.md`，与用户 `.pi/agents/*.md` 同一套解析，同名用户文件优先；issue 100 起为对齐 Claude Code 的三角色）：
  - `explore`（只读搜索专家，最低思考档 `minimal`，工具：`read, grep, find, ls, bash`；正文强约束只读、不得改文件；`description:` 触发句含反例边界——不做 code review / 跨文件一致性检查——并约定调用方在任务里写明 search breadth：quick / medium / very thorough）
  - `plan`（只读实现规划，不设思考档，工具同 `explore`，正文要求以 `### Critical Files for Implementation` 收尾给出关键文件清单）
  - 角色文档的 `description:` frontmatter 是给调度模型的触发句（渲染进 roster），**不注入子代理提示词**；无该字段的自定义角色在 roster 中显示裸名。触发句来源同正文：改编自 tintinweb，不从 Claude Code 摘。
  - `general-purpose`（**默认角色**，不声明 `tools:` → 继承 pi 默认全量工具；规则见下）
  - **省略 `agent` = 用 `general-purpose` 文档当模板**（`DEFAULT_AGENT_NAME`，与 Claude Code 一致），因此默认路径不再是无系统提示词的裸子会话。模型可见的可用角色列表会过滤掉默认角色，只列 `explore, plan` 并提示可省略 `agent`（issue 097 的错误文本一并随之更新）。
  - **观察期约定（issue 102 遗留）**：roster + 触发句上线后，若 `explore`/`plan` 在真实使用中仍长期无主动选用，将收敛到只剩 `general-purpose`（届时另立 issue；自定义角色可见性不受影响）。
  - 这三个角色的正文**改编自 `@tintinweb/pi-subagents`（MIT，Copyright (c) 2026 tintinweb）**，不是逐字复制 Claude Code——后者的提示词是 `© Anthropic PBC. All rights reserved.` 且本包以 MIT 公开发布 `agents/`，逐字搬运会变成版权文本的再分发（出处与措辞见 README `### Attribution`）。要改角色设计时沿用这个来源，不要直接从 Claude Code 摘。
- `/subagent`：用户交互式命令，支持配置全局/项目默认模型与思考强度、为角色绑定模型，以及查看当前运行中与最近完成的 subagent 任务（运行中可看详细进度卡与终止；结束后可看输出）。为 `explore` 绑模型时选择器标题提示「便宜快模型更合适」（不硬编码供应商，issue 102 决策 D2）。在任何子菜单按 `Esc` 均返回上一级。
- **配置文件**：全局 `<pkg-config 根>/pi-subagent/settings.json`（根 = `$PI_PKG_CFG_DIR` 或 `<agent dir>/pi-pkg-cfg`），project 层 `<project>/.pi/pi-pkg-cfg/pi-subagent/settings.json`（仅在显式选 project scope 且项目受信时写入）。文件顶层即节本体（无外层 `subagent` 键）。老的 Pi `settings.json` `subagent` 节（含 `subagents.agentOverrides`/`subagents.agents` 兼容形状）与新位置缺失时的老项目 `<project>/.pi/settings.json` 只读回退，新文件一存在即不再参与读取，老文件不被删改；生效值来自回退路径时状态输出标 `legacy (read-only fallback): <path>`。
- 状态栏：有任务运行时显示 `sub:N · <agent> <elapsed> · …`,**每个运行中任务一格**(最老优先)，上限 3 个后缀 `+N more`;全部结束自动清除。

## 核心机制

1. **子进程流式通信与单任务执行**：
   - 自动解析 `pi` CLI 路径，以 `--mode json -p` 启动子进程并通过 stdin 传输指令。
   - 注入 `PI_SUBAGENT_CHILD=1` 环境变量防止嵌套递归。
   - 一次调用恰好跑一个子进程(095);并行由模型发多个 tool call 天然获得，`ProgressDetails.runs` 保留数组形状但恒为单元素。
2. **防爆门与 Pi 原生 Session 断点续跑**：
   - 默认 20 分钟超时与 50 轮上限；达到上限时安全暂停子进程并输出 Session ID 与恢复提示。
   - 超时执行三重冗余（ff 108，Windows pi-rpc 主机上 unref'd one-shot timer 曾迟到 51s–54m50s 才触发）：one-shot timer + 每条子进程事件的 deadline 检查 + 1s unref'd 看门狗 interval，任一路径独立可执行 deadline；兜底迟到 >1s 在 stderrTail 留痕，`PI_SUBAGENT_DEBUG=1` 打诊断日志；paused 文案报实际 elapsed（`timed out after X (limit: Y, turns: N)`）而非配置值。
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
5. **用户控制的执行策略**：模型优先级为 `agents[x].model`（`<pkg-config 根>/pi-subagent/settings.json`） > agent 文档 model（`.pi/agents/x.md`、`<agentDir>/agents/x.md`、包内 `agents/x.md`，后者与内置角色是同一机制） > `defaultModel`（settings 文件） > 继承父会话当前完整 provider/model（ctx → 事件追踪 → PI_PROVIDER/PI_MODEL env） > 子进程自身默认`；思考强度同链对称（角色设置 > agent 文档 > subagent 默认 > 父会话）。内置角色是包内 `agents/{explore,plan,general-purpose}.md`，与用户文档同解析、同名用户文件优先；`explore` 最低档（`minimal`，由 pi 按子模型能力向上夹取）、`plan` 不设档随父会话、`general-purpose` 不设档随父会话。`off` 也是真实档位，会随继承传给子进程（`buildPiArgs` 不再丢弃它）。Agent 的单次 tool call 无权覆盖二者。未显式配置时不读取 pi settings 根层 `defaultProvider`/`defaultModel`/`defaultThinkingLevel`。
6. **Codemode 环境下的工具白名单与权限收敛（ff 109）**：当父会话处于 `codemode: "only"`（或激活了 `codemode`）时，若子任务指定了 `tools` 白名单（入参 `tools` 或角色如 `explore` / `plan` 声明的 `tools`），系统在拼装子进程 `--tools` 时会自动补齐 `codemode`（如 `--tools codemode,read,grep,find`）。子代理在子进程中继续跑在 `codemode: "only"` 模式下，同时沙箱内部仅能调用白名单中指定的工具，未授权工具（如 `edit`/`write`/`bash`）在物理层面被剔除，既避免了与 `hide-direct-tools.js` 的调用拦截冲突，又实现了真正的物理级工具权限收敛。
7. **子进程环境变量透传（issue 101）**：`env`（`Record<string, string>`）为所有子进程附加环境变量。全局 `<pkg-config 根>/pi-subagent/settings.json` 与项目 `<project>/.pi/pi-pkg-cfg/pi-subagent/settings.json` 都读（老位置 Pi `settings.json` 的 `subagent` 节只读回退），**逐键合并、项目覆盖全局、未冲突的全局键保留**；项目 env 受信任门约束（`loadSubagentSettings(cwd, projectTrusted=false)` 直接返回全局设置，项目 env 整段丢弃）。合并顺序固定为 `process.env → subagent.env → PI_SUBAGENT_CHILD="1"`，守卫最后应用因而**不可被设置覆盖**——用户把它设成 `"0"` 会让子进程重新加载本扩展并递归。只接受字符串值：数字/布尔/`null`/对象/数组一律丢弃（不静默强转，避免 `null→"null"`、`{}→"[object Object]"` 这类语义被改写），键名 trim 后为空也丢弃，整张空 map 归 `undefined`（**空 map 不代表“清空”，不会抹掉全局键**）。合并逻辑集中在导出的 `buildChildEnv(cfg)`，全项目 `spawn(` 仅一处（`src/index.ts:1050`）调用它。本包**不特判任何具体扩展的开关名**；`/subagent` 菜单不提供 env 编辑界面（键值表交互不划算，属高级 JSON 配置）。

## 明确不做

- 前台/阻塞模式或任何 `async` 开关；
- `tasks[]` 批量、`chain` 流水线或任何多任务入参(095 已删,不回归)：并行属于模型的 tool call 层,不属于本工具的入参层；
- 聊天流内的实时进度卡与 Alt+O 展开；
- print 模式（`pi -p` / `--mode json`）下的结果回落：进程跑完一回合即退出，后台 subagent 没有下一回合可送达，结果随进程丢（与 background-terminal 079 同一取舍）。

## 使用路径

| 目的 | 入口 |
|---|---|
| 执行独立子任务 / 审查 / 探索 | `subagent({ task: "..." })`（省略 `agent` = 通用子 agent）→ 立即返回，结果以新消息到达 |
| 任务恰好是只读探索 / 实现规划 | `subagent({ agent: "explore\|plan", task: "..." })`，角色会收窄工具集与思考档 |
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

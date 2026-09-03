# pi-subagent

## 定位

`@bytetrue/pi-subagent` 提供单一轻量 Agent 工具 `subagent` 以及用户配置命令 `/subagent`：在隔离的子进程会话中执行特定子任务、代码审查或探索性工作，并带有实时的 TUI 差分进度卡片和 Token/费用统计。

它不依赖任何外部框架或 Python 脚本，采用纯 TypeScript 实现，通过 Pi 原生 CLI 启动子进程并流式解析 JSON 事件。

## 当前表面

- `subagent(params)`：
  - `tasks`（必填）：任务对象数组 `Array<{ task, agent?, model?, thinking?, tools?, cwd?, resume?, id?, timeoutMs?, maxTurns? }>`。
  - `chain`（可选，默认 `false`）：设置为 `true` 时按顺序流水线执行（前序输出自动作为后序输入）；默认 `false` 为并发执行。
  - `async`（可选，默认 `false`）：设置为 `true` 时在后台脱机执行，不阻塞当前会话；完成后通过 `followUp + triggerTurn` 自动唤醒主模型。
  - `timeoutMs`（可选，默认 `1200000` 即 20 分钟）：任务超时限制。
  - `maxTurns`（可选，默认 `50` 轮）：任务轮次限制。
- 内置角色预设：
  - `scout`（只读快速侦察，`thinking: low`，工具：`read, grep, find`）
  - `researcher`（技术与网络调研，`thinking: medium`，工具：`read, grep, find, web_search, web_fetch`）
  - `reviewer`（代码审查与跑测，`thinking: high`，工具：`read, grep, find, bash`）
- `/subagent`：用户交互式命令，支持配置全局/项目默认模型与思考强度、为角色绑定模型，以及查看当前运行中与最近完成的 subagent 任务（支持查看输出与主动终止）。在任何子菜单按 `Esc` 均返回上一级。
- 状态栏联动：底部状态栏在有任何前台或后台 subagent 运行时自动显示 `sub:N`，全部结束自动清除。

## 核心机制

1. **子进程流式通信与并发/流水线调度**：
   - 自动解析 `pi` CLI 路径，以 `--mode json -p` 启动子进程并通过 stdin 传输指令。
   - 注入 `PI_SUBAGENT_CHILD=1` 环境变量防止嵌套递归。
   - 默认并发执行（`Promise.all`），在 `chain: true` 时顺序串行执行并传递输出；任何一步失败自动熔断。
2. **防爆门与 Pi 原生 Session 断点续跑**：
   - 默认 20 分钟超时与 50 轮上限；达到上限时安全暂停子进程并输出 Session ID 与恢复提示。
   - 传递 `--session-id <id>`（初次）与 `--session <id>`（恢复），无缝复用 Pi 原生标准会话存储与断点续接机制。
3. **后台异步脱机与状态栏监控**：
   - 声明 `async: true` 后立即返回 Task ID，主会话零阻塞。
   - 后台任务完成时，通过 Pi 的 `followUp` 事件唤醒主会话并递交结果；若主模型正在响应，暂存至 `agent_settled` 时合并唤醒。
   - 状态栏实时显示当前活跃任务数（`sub:N`，覆盖前台和后台），会话退出时（`session_shutdown`）自动清理。
4. **交互式 TUI 与任务监控面板**：
   - `/subagent` 采用栈式导航，任何子层级按 `Esc` 或选 Back 均返回上一层，根菜单按 `Esc` 退出。
   - 模型选择器支持输入文本实时模糊匹配（Fuzzy search），且支持上下循环滚动（在第一项按向上箭头直接循环到最后一项，反之亦然）。
   - 提供 `View Active Subagents` 面板，支持查看当前会话中每个任务的状态、已运行时长、输出，并可确认终止运行中的任务。
5. **实时 TUI 差分渲染**：
   - 流式解析子进程 stdout 输出的 JSON 事件，实时更新 Spinner、耗时、思考意图、活跃工具调用与 Token/费用统计。
   - 快捷键 `Alt+O` 随时展开/收起卡片详情。

## 使用路径

| 目的 | 入口 |
|---|---|
| 执行独立子任务 / 审查 / 探索 | `subagent({ tasks: [{ task: "..." }] })` |
| 并行对比或批量处理 | `subagent({ tasks: [{ task: "1" }, { task: "2" }] })` |
| 链式多步骤流转 | `subagent({ chain: true, tasks: [...] })` |
| 配置默认模型与角色映射 | `/subagent` 用户菜单 |
| 查看运行中任务与输出 / 停止任务 | `/subagent` → `View Active Subagents` |
| 查看当前配置与识别的角色 | `/subagent list` 或 `/subagent show` |
| 展开/收起终端实时卡片 | 快捷键 `Alt+O` |

## 验证

```bash
npm --workspace @bytetrue/pi-subagent test
npm --workspace @bytetrue/pi-subagent run typecheck
```

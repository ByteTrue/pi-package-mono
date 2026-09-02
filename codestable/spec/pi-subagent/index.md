# pi-subagent

## 定位

`@bytetrue/pi-subagent` 提供单一轻量 Agent 工具 `subagent` 以及用户配置命令 `/subagent`：在隔离的子进程会话中执行特定的子任务、独立调研或代码审查，并带有实时的 TUI 差分进度卡片和 Token/费用统计。

它不依赖任何外部框架或 Python 脚本，采用纯 TypeScript 实现，通过 Pi 原生 CLI 启动子进程并流式解析 JSON 事件。

## 当前表面

- `subagent(task, ...)`：
  - `task` / `prompt`：传递给子智能体的具体任务。
  - `agent`（可选）：指定智能体模板名称，自动从 `.pi/agents/<name>.md` 或 `~/.pi/agent/agents/<name>.md` 加载 frontmatter 配置（如专属 model、thinking、tools 和 prompt）。
  - `mode`（可选）：`single`（默认）、`parallel`（并行运行多个 task 并合并输出）、`chain`（顺序链式执行，前序输出作为后序输入）。
  - `tasks` / `prompts`（可选）：并行或链式模式下的多任务列表。
  - `model`（可选）：单次调用的模型覆盖（如 `openai/gpt-4o:low`、`gemini-3.7-flash`）。
  - `thinking`（可选）：单次调用的思考强度覆盖（`off` ~ `max`）。
  - `tools`（可选）：子智能体的可用工具白名单（例如指定 `["read", "grep", "find", "web_search"]` 仅开启只读调研）。
  - `cwd`（可选）：子进程执行的工作目录。

## 核心机制

1. **子进程流式通信**：
   - 自动解析 `pi` 可执行文件位置（支持当前 node_modules、全局 npm/mise 安装路径及 PATH）。
   - 以 `--mode json -p --no-session` 启动子进程，并将任务输入通过 `stdin` 写入。
   - 注入 `PI_SUBAGENT_CHILD=1` 环境变量，防止子进程递归嵌套调用自身。
2. **实时 TUI 差分渲染**：
   - 流式解析子进程 stdout 输出的 JSON 事件（`agent_start`, `turn_start`, `message_update`, `tool_execution_start`, `tool_execution_end`, `message_end`, `agent_end`）。
   - 渲染包含运行时间、Spinner、当前思考意图、活跃工具调用与参数预览、Token 上行/下行和费用的 TUI 卡片。
   - 注册快捷键 `Alt+O`，可随时展开/收起最新卡片的详细工具调用链路。
3. **安全与进程生命周期**：
   - 支持通过 `AbortSignal` 进行平滑终止：收到取消信号先发 `SIGINT`，并在 1.5s 宽限期后执行 `SIGKILL` 清理进程树。

## 使用路径

| 目的 | 入口 |
|---|---|
| 执行独立调研 / 代码审查 | `subagent({ task: "...", tools: ["read", "grep", "find"] })` |
| 并行对比或批量处理 | `subagent({ mode: "parallel", tasks: ["task 1", "task 2"] })` |
| 链式多步骤流转 | `subagent({ mode: "chain", tasks: ["step 1", "step 2"] })` |
| 配置默认模型与角色映射 | `/subagent` 用户菜单 |
| 查看当前配置与识别的角色 | `/subagent list` 或 `/subagent show` |
| 展开/收起终端实时卡片 | 快捷键 `Alt+O` |

## 验证

```bash
npm --workspace @bytetrue/pi-subagent test
npm --workspace @bytetrue/pi-subagent run typecheck
```

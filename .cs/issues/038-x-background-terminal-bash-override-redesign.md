---
kind: issue
title: "background terminal 改为 bash 加 background 参数的最小设计"
type: feature
status: closed
created: 2026-08-01
epic: ""
superseded_by: ".cs/issues/039-x-background-terminal-standalone-tools.md"
---

# background terminal 改为 bash 加 background 参数的最小设计

## 目标

用户明确反馈：现有基于 `opencode-pty` 对齐的 5-tool PTY 设计，实际使用体验比不装这个插件还差。追问后发现对齐对象本身站不住——OpenCode 官方根本没有后台/PTY 能力，被当成 spec 的 `opencode-pty` 只是一个自带未解决 bug 的第三方社区插件。用户随后给出明确产品方向：不再对齐任何外部产品，只做一件事——**让一个命令能脱手在后台跑，一个命令搞定**。

## 归属

- 独立 issue，取代 `.cs/issues/037-x-background-terminal-tool-selection.md`。
- 相关 spec：`.cs/spec/pi-background-terminal/index.md`

## 背景与证据

核实结论（用户直接质疑后逐一查证）：

| 产品 | 真实情况 |
|---|---|
| OpenCode 官方内建工具（opencode.ai/docs/tools） | 只有同步 `bash` + edit/write/read/grep/glob/lsp/apply_patch/skill/todowrite/webfetch/websearch/question；**没有任何后台/PTY 工具**。 |
| `shekohex/opencode-pty` | 个人开发者维护的第三方社区插件；GitHub issues 里有多个未解决的跨平台 bug（Windows 崩溃、GLIBC 不兼容、插件加载失败）；依赖 Bun 专属 `bun-pty`。 |
| Claude Code（Anthropic 官方） | 原生自带：`Bash` 工具的 `run_in_background` 参数 + `BashOutput`/`KillBash` 工具，2025-08 上线。 |
| Codex CLI（OpenAI） | 也在演进类似能力（`/ps`、`/stop`、`exec_command`+PTY），有过回归问题。 |

Pi 自身文档（`docs/usage.md`）明确写："It intentionally does not include ... background bash. You can build or install those workflows as extensions or packages" ——即 Pi core 故意不做，留给 package。同时 Pi 的 `docs/extensions.md` "Overriding Built-in Tools" 一节（0.62.0 起支持）明确允许扩展用同名 `pi.registerTool()` 覆盖内建 `read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`；`createLocalBashOperations()`（0.60.0 起）把 Pi 自己的本地 shell backend（跨平台 shell 解析、detached 进程组、AbortSignal → 进程树 kill、超时）暴露成可复用的公开 API。

## 质量目标

- 功能正确性：普通 `bash` 调用（不传 `background`）的行为必须与内建 bash 完全一致；以真实前台命令、超时、非零退出码回归验证。
- 可用性 / 效率：后台启动必须立即返回、不阻塞；查看/停止必须各一个动作完成，不需要轮询链；以真实 Pi 非交互回归的调用次数验证。
- 正确性（进程控制）：kill 必须是真实的操作系统进程树终止，不是仅改状态位；以真实子进程 PID 存活检查验证。

## 影响范围

- **必须修改**：整包重写。删除 `src/pty/`、`src/web/`、5 个 `tools/pty-*.ts`、`commands.ts`、`browser.ts`、`register-tools.ts`；`package.json` 去掉 `@lydell/node-pty`/`ws`/`@xterm/*`/`esbuild`；README、`.cs/spec/pi-background-terminal/index.md`、根 `README.md`。
- **需要验证**：前台 bash 语义不变、后台启动/查看/停止、自动完成通知、session 生命周期清理、真实进程树 kill。
- **不包含**：交互式 stdin/Ctrl-C（PTY 能力）——用户的诉求明确是"脱手"，故意不做交互；需要交互的任务应在真实终端里跑。

## 方案判断

- **不再对标任何外部产品**：Claude Code/Codex 的思路可以参考，但不作为必须逐字对齐的 spec；只解决用户点名的这一个需求。
- **复用 Pi 官方扩展点，不重新发明**：用 `pi.registerTool({name: "bash", ...})` 覆盖内建同名工具（Pi 明确支持、有官方示例 `tool-override.ts`）；后台执行复用 `createLocalBashOperations().exec()`（Pi 自己的本地 shell backend），只是不 await 它，让它在后台继续跑，通过其 `onData`/`AbortSignal` 拿输出和实现真 kill——不用 `child_process.spawn` 从零重写 shell 解析、超时、跨平台进程树终止。
- **不做 PTY**：没有交互输入需求，就不需要伪终端；去掉 `@lydell/node-pty` 原生 addon 依赖，同时消除了这个依赖曾经引发的两类真实故障（worktree 里 `node_modules` 缺失时的加载失败、上游插件本身的 GLIBC/Windows 兼容 bug 类型风险）。
- **自动完成通知保留**：`notifyOnExit` 这个思路本身是对的（此前真实 Pi 回归证明能避免轮询），只是不作为可选参数——后台任务默认就会在完成时自动通知，不需要模型记得开关它。

## 实现设计

```text
Extension entry (index.ts)
  ├─ tools/bash.ts        覆盖内建 bash；无 background 时直接委托 createBashToolDefinition().execute
  ├─ tools/bash-output.ts 按 id 读状态/输出，offset/limit 翻页
  ├─ tools/bash-kill.ts   按 id 调 AbortController.abort()
  ├─ background/manager.ts
  │    └─ createLocalBashOperations().exec()（不 await，onData 累积到内存 buffer，abort 触发真实进程树 kill）
  └─ renderers.ts         自动完成通知的自定义消息渲染（bash-background-exit）
```

- `bash` schema：`command`/`timeout` 与内建完全一致，新增 `background?: boolean`（默认 false）。
- 后台任务：`bg_<hex>` id，状态 running/exited/killed，输出 buffer 上限约 200K 字符（超限丢最早部分）。
- session 隔离：任务按 `parentSessionId` 隔离；`session_shutdown` 清空并 abort 该 session 所有仍在跑的任务。
- 渲染：`bash` 覆盖不提供自己的 `renderCall`/`renderResult`，Pi 按文档规则自动回退到内建 bash 渲染器。

## 验证

- 单测（真实子进程，不 mock）：
  - `background/manager.test.ts`（4 tests）：启动/捕获输出/退出状态、按 session 隔离 get/list、kill 真的停止并标记 killed、`clearSession` 只清自己会话的任务。
  - `tools/bash.test.ts`（3 tests）：前台命令与内建 bash 一致、`background: true` 立即返回（&lt;2s，命令本身 sleep 5s）、非零退出码在前台路径正确抛错（`exit 3`）。
  - `tools/bash-output.test.ts`（3 tests）：读状态+输出、offset/limit 翻页、未知 id 报错。
  - `tools/bash-kill.test.ts`（3 tests）：真的停止运行中的任务、已结束任务返回友好提示不报错、未知 id 报错。
  - `index.test.ts`（1 test）：只注册 `bash`/`bash_output`/`bash_kill` 三个工具、`session_start`/`session_shutdown` 两个生命周期钩子、一个消息渲染器。
- package typecheck 通过；`npm test` 5 files / 14 tests 全绿。
- 真实 Pi 0.82.1（`bytetrueapi/claude-haiku-4-5`）非交互回归，仅自然语言（未提示工具名）：
  - 普通 `echo`：只调 `bash`，不带 `background`，行为与内建一致。
  - 明确要求越过 tool call 存活的后台服务：`bash(background:true)` 立即返回任务 id，未等待未读日志。
  - 后台启动 + 立即查看：`bash` → `bash_output`（一次），状态 running，看到已产出的输出行。
  - 后台启动 + 确认运行中 + 停止：`bash` → `bash_output` → `bash_kill`，三步完成，0 错误。
  - 后台任务自动完成通知：只调用一次 `bash_output`，模型报告"已经收到后台任务的完成通知了"，退出码正确。
- 真实进程树 kill 验证（脱离模型，直接测试）：后台任务把自己的 PID 写入临时文件；`bash_kill` 之后用 `kill -0 <pid>` 确认进程确实不存在（不是只改状态位）。
- 独立 review 发现一个 blocker：`session_shutdown` 无条件 `clearSession` 会在用户 `/reload` 时静默杀掉所有后台任务——核实 Pi `agent-session.js` 源码确认 `/reload` 在同一 session 上重新发 `session_shutdown`/`session_start`（`reason: "reload"`），不创建新 session。修复：`session_shutdown` handler 在 `event.reason === "reload"` 时直接 return，跳过 `clearSession` 与 `currentSessionId` 重置。新增 `index.test.ts` 回归：模拟 `reload` 后任务仍 `running`，而 `quit` 后任务被清除。
- 二轮独立 review：第一轮 blocking 1（上述 `/reload` 问题），已修复并回归；其余 3 条 note（单例 singleton onExit 在多 session 嵌入场景下的潜在问题、foreground/background cwd 来源不一致、"no output yet" 措辞）均为低优先级且不影响当前 Pi CLI 单 session 用法，暂不处理。

## 执行记录

- 已核实 OpenCode 官方文档、`opencode-pty` 仓库真实性质、Claude Code/Codex 的对应能力。
- 已读 Pi 官方 `docs/extensions.md`（Overriding Built-in Tools、Remote Execution 两节）与 CHANGELOG，确认 `createBashToolDefinition`/`createLocalBashOperations` 自 0.60.0/0.62.0 起就是公开、文档化的扩展点，早于本仓库 `>=0.79.10` 的现有 peer 下限。
- 已完成整包重写、删除依赖、单测与真实 Pi 回归。

## 关闭回写

- project spec：`.cs/spec/pi-background-terminal/index.md`
- 包 README：`packages/pi-background-terminal/README.md`
- 根 README：`README.md`

## 关闭结论

- **关闭判断**：实现并验证完成后，用户在下一轮对话中提出两个新需求：(1) 不想覆盖 `bash`，不想影响 Pi 原生工具；(2) 输出应该落盘以控制上下文大小、timeout 应该必传。这两条与本 issue 的核心前提（覆盖 bash + 内存 buffer + timeout 可选）直接冲突，因此本 issue 的设计被整体取代，非改进。
- **superseded_by**：`.cs/issues/039-x-background-terminal-standalone-tools.md`
- 保留本 issue 作为历史：它真实实现并通过了验证（包括发现并修复了 `/reload` 会静默杀掉后台任务的真实 blocker），下一代设计完全继承了这个修复。

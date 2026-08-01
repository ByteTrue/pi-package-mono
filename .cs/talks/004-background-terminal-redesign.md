# background terminal 三次重设计：从 OpenCode 风格 PTY 到独立后台工具

## 原始想法

用户报告 pi-background-terminal 实际使用体验非常奇怪：模型不管什么命令都倾向于用 PTY 而不是 bash，产生大量垃圾后台进程，效率比不装这个包还低。要求指定 Pi session 逆向排查。

## 真问题

排查发现两层问题，一层比一层根本：

1. **第一层（工具提示词）**：`pty_spawn` 的 guideline 把"之后可能想看日志"当成使用理由，`pty_list` 又要求每次操作前先查一遍，共同放大了调用链。修复：收紧 bash-first 措辞。
2. **第二层（对齐对象本身错了）**：用户追问"我们抄的这个插件本身是不是也不好"，核实后发现：OpenCode 官方核心**没有任何后台/PTY 工具**（只有同步 `bash`）；当初对齐的 `opencode-pty` 是个人开发者维护的第三方社区插件，自带未解决的 Windows 崩溃、GLIBC 不兼容等 bug。真正原生有后台执行能力的是 Claude Code（`run_in_background` + 独立查看/停止工具）和 Codex CLI。

用户结论：作废整个 5-tool PTY 设计，重新来。

## 术语

- **后台任务（background task）**：一次 `background_run` 调用产生的后台命令，有 id、状态、输出文件。
- **timed_out**：因达到 `timeoutSeconds` 被自动终止，区别于用户手动 `background_kill` 的 `killed`。
- **落盘输出**：命令的 stdout/stderr 实时写入一个临时文件，工具本身不重复实现分页读取，直接让 agent 用已有的 `read` 工具去读。

## 已确认决策

1. **不覆盖 `bash`，不碰 Pi 原生工具**——第一版曾经覆盖内建 `bash` 加 `background` 参数；用户明确要求改成完全独立的工具，`bash` 保持 Pi 自己的样子。
2. **三个工具，精确对应用户说的"运行/查看/管理/通知"四件事**（通知是自动的，不需要工具）：
   - `background_run(command, timeoutSeconds)` —— 立即返回任务 id
   - `background_status(id?)` —— 不传 id 列表，传 id 看详情
   - `background_kill(id)` —— 手动停止
3. **查看/管理合并为一个工具**（`background_status`），而不是拆成"列表"+"详情"两个：用户认可，理由是"有且仅有"应该体现在工具数量上，"查看"这个词本身也没区分列表和详情。
4. **输出落盘，不再内存 buffer**。用户给出的理由是**上下文管理**，不是"进程重启幸存"：命令输出可能很多，如果一次性整段塞进 agent 上下文容易爆炸；落盘后 agent 可以用已有的 `read` 工具选择性地看，不用我们自己重新实现 offset/limit 分页。
5. **`timeoutSeconds` 是必传参数**，不是可选。用户理由：怕长命令卡死没有兜底。内部复用 Pi 内建 bash 工具本身就有的 timeout 校验和跨平台 kill 逻辑（`createLocalBashOperations`），不用自己重写。
6. **完成时自动唤醒 agent**，机制是 `pi.sendMessage(..., {deliverAs:"followUp", triggerTurn:true})`——验证过这不是"发个消息给人看"，而是 Pi 明确设计用来在 agent 闲下来时立刻触发下一轮 LLM 调用；`display:true` 只是顺带也给人类可见，不是主要目的。用户确认这条完全符合他要的语义：agent 后台起命令、本轮消息结束、命令跑完自动唤醒 agent 继续对话。
7. **`/reload` 不清任务**——沿用第二版已经发现并修的坑：Pi 的 `/reload` 在同一个 session 上重新触发 `session_shutdown`/`session_start`，不是真正的会话结束；只有 quit/新会话/切换/fork 才清任务并删除输出文件。

## 偏好与约束

- 保持简单是主线：不加 `workdir`/`env` 等未被要求的参数；不加输出文件大小上限（`timeoutSeconds` 兜底命令时长，`read` 工具自己的截断兜底单次阅读量）。
- 核实过 Pi 本身没有类似 OpenCode/Claude Code 的"跑命令前弹窗确认"权限系统，所以不覆盖 `bash` 不会绕开什么本来存在的安全闸门——因为闸门本来就不存在。
- 内部实现继续复用 `createLocalBashOperations()`（Pi 自己导出的本地 shell 执行器），保留跨平台正确性（Windows 用 Git Bash + `taskkill /F /T`，POSIX 用进程组 `SIGKILL`）；这只是调用一个纯函数，不是"碰"内建工具。

## 影响与取舍

- 相比第二版（覆盖 `bash` + `background` 参数）：删除 bash 覆盖逻辑，新增三个独立工具；`bash_output`/`bash_kill` 改名为 `background_status`/`background_kill`；`manager.ts` 从内存 buffer 改为文件流，新增 `timed_out` 状态。
- 相比第一版（5-tool PTY）：无 PTY、无原生依赖、无 Web monitor，这部分结论未变。
- 与 Claude Code 的对比：确认不是"抄 Claude Code"——Claude Code 现在的 `TaskOutput` 已废弃，转向让模型直接 `Read` 任务输出文件；本设计独立得出类似结论（落盘 + 复用已有 read 工具），是同一个道理各自推导，不是对齐哪个产品。

## 已确认 / 待确认边界

**已确认**：三工具形态、落盘、必传 timeout、不碰 bash、`/reload` 安全、自动唤醒机制。

**待确认**：无——本轮讨论到此收拢，用户已说"开始吧"。

## 最大未知

无遗留未知；输出文件是否需要应用层大小上限留作后续按真实需要再评估，不在本轮范围。

## 初步出口草案

- **目标**：pi-background-terminal 提供三个独立工具（不覆盖任何 Pi 原生工具），实现"跑/查看/管理/通知"四件事。
- **范围**：重写 `background/manager.ts`、新建 `background-run.ts`/`background-status.ts`/`background-kill.ts`、删除 `bash.ts` 覆盖及其测试、更新 `index.ts`/`renderers.ts`/`constants.ts`、更新包 README 与 `.cs/spec/pi-background-terminal/index.md`。
- **验证**：真实子进程单测（含 timeout 触发路径、`clearSession` 删文件验证）；真实 Pi 0.82.1 非交互回归（普通 bash 不受影响、后台运行/查看/停止/超时自动终止/完成自动唤醒）；独立 review。
- **依赖**：`createLocalBashOperations()`（Pi 公开 API，无新依赖）。
- **暂不纳入**：`workdir`/`env` 自定义参数、输出文件大小上限。
- **出口**：受管理实现（issue），因为是全包重写、有真实验证需求，不是一次性小改。issue 038（覆盖 bash 的第二版）标记 superseded。

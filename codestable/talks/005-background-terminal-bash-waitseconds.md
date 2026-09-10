# background terminal 工具选择困难 → bash 覆盖 + waitSeconds 统一执行

## 开场：用户的原始问题

用户报告 pi-background-terminal 实际使用中的 LLM 工具选择困难：模型要么把所有命令都走后台工具，要么全部走内建 bash，不会分。用户记得看过一个设计——默认只暴露一个 bash，命令超时后自动转后台并发通知。两个问题：(1) 有些场景想要超时就停，这和超时转后台怎么平衡；(2) 面向 LLM 的工具面到底怎么设计才好。

## 查证：记忆中的设计是 Codex unified exec

读了 Codex 源码（`codex-rs/core/src/unified_exec/mod.rs`）确认：

- 单 `exec_command` 工具 + `yield_time_ms` 参数（钳制 250ms–30s）：命令在 yield 时间内跑完→直接返回输出；没跑完→标记 still running 转后台，模型继续干别的，退出后 follow-up 唤醒。
- 后台任务独立硬超时（`DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS = 300_000`）。
- 两个真实翻车案例：[#33712](https://github.com/openai/codex/issues/33712) 后台任务在 session 空闲时退出永远不产生 follow-up（本项目已用 followUp + triggerTurn + `agent_settled` 缓冲解决，是领先点）；[#6715](https://github.com/openai/codex/issues/6715) 模型每次硬编码同一个 yield 值——懒参数是常态，设计必须对"不带脑子用工具"健壮。

对照组 Claude Code：`run_in_background` 是显式预判参数（模型先猜命令长不长再决定传不传），且 [#88702](https://github.com/anthropics/claude-code/issues/88702) 证实后台模式下 `timeout` 参数根本不生效——单一参数承载两种语义（杀 vs 转）的冲突在真实产品里就是这么爆的。

## 分析收束：根因与两个原则

本包自己的三代失败（037 五工具全走 PTY → 039 三工具全走一边 → Codex 懒参数）共同点：**工具边界画在"命令会跑多久"上，而时长是模型无法预测的东西**。模型每次调用时真正确定的只有偏好：要不要阻塞这个 turn 等结果。

- **原则一（分类轴）**：边界画在偏好上（要不要阻塞），不画在预测上（要跑多久）。让机制吸收时长不确定性（等待→转后台→通知），不要求模型预测时长。
- **原则二（kill vs demote）**：不是模式开关，是两个正交阈值——**patience**（愿意同步等多久，超过转后台）与 **safety**（总寿命硬杀上界）。"超时就停"= patience≈safety；"转后台"= patience 小、safety 大；"长驻服务"= patience=0、safety=∞。Codex 正是此结构；Claude Code 把两种语义塞进一个 timeout 然后后台失效是反面教材。

## 关键纠正：第一轮方案被用户推翻

助手第一轮推荐"不碰 bash，给 `background_run` 加 `waitSeconds` 同步快路径"。用户纠正：**加了快路径后这个工具就不是后台工具了，名字在撒谎**；而且造成两个高度重叠的通用执行器（内建 bash + 名字撒谎的 background_run），选择问题没有消除，只是换了形态。名字本身（"background"）就是预测轴的残留。**最终以覆盖 bash 的方案为准。**

## 翻转 039 决策的论证（用户已确认）

039 拒绝覆盖 bash 时，替代方案是 038 的 `bash(background: true)`——显式预判参数，模型仍要先猜"要不要后台"，拒绝它是对的。但新设计性质相反：`waitSeconds` 是**移除一个选择**（从"两个重叠工具里挑"变成"一个工具里可选的耐心参数"），且不传时纯委托内建、行为零变化。前提变了，决策重算后用户确认翻转 039 已确认决策第 1 条（不覆盖内建工具）。

## 已确认决策与稳定约束

1. **覆盖 `bash`（及 Windows `powershell`，同一 wrapper 模式）**，schema 从 `createBashToolDefinition()` 组合追加 `waitSeconds`，不手抄副本（实测 `bashSchema = {command, timeout?}`，`ToolDefinition` 含 execute/render，组合可行）。
2. **不传 `waitSeconds` → 纯委托内建 execute**，行为逐字节一致；600s 默认超时注入照旧。
3. **`waitSeconds: 0`** → 立即转后台（收编今天的 `background_run`）；**`N > 0`** → 同步竞态：退出则内联返回输出（用 Pi 导出的截断），超时则转后台 + task id + 退出自动通知（现有机制照旧）。
4. **`timeout` = 总寿命硬杀**：设了就到点必死（后台任务不再有无声挂死）；不设则不限（服务器友好）。带 `waitSeconds` 的调用必须跳过 600s 默认注入，否则 dev server 10 分钟被杀。
5. **工具面 3 → 2**：删除 `background_run`；`background_status`/`background_kill` 保留（管理"后台任务"这个运行时状态，不管谁产生）；`/background` 菜单、footer、通知机制不动。

## 架构确认：基于 bash 扩展，不是重实现

用户明确验证过这一点，三层分工：默认路径 100% 内建 execute 转发；waitSeconds 路径进程生命周期走 `createLocalBashOperations().exec()`（Pi 自己的 shell backend，`exec` 原生支持 `timeout` 与 `AbortSignal`，现有 manager 同款），自己新写的只有竞态与内联格式化；schema 从内建定义组合。**从不自己写**：shell 解析、spawn、超时校验、跨平台进程树 kill、输出截断。

## 影响、风险与取舍（已向用户列出并接受）

- schema 遮蔽：模型看到我们声明的 schema，Pi 上游演化 bash 需跟（缓解：组合式构建 + peer 版本锁定 + changelog 跟踪）。
- 本包成为所有命令的承载路径：默认路径零逻辑纯委托，自己的代码只在 waitSeconds 分支；包卸载/加载失败自动回退内建。
- 同名 override 冲突：装另一个覆盖 bash 的包时只有一个生效；README 写明。
- 065 hook 去留（覆盖后 bash 默认超时可自管）：issue 内定。

## 候选质量目标（转 issue 时成为承诺）

- 兼容性/隔离性：不传 waitSeconds 的调用行为与未装本包时一致。
- 功能正确性：竞态边界（等待中退出、转后台瞬间退出、timeout<waitSeconds 等价 kill）。
- 性能效率：零轮询，通知驱动不变。
- 可维护性：schema 组合自内建定义，无手抄副本。

## 出口

受管理实现：`codestable/issues/071-o-background-terminal-bash-waitseconds.md`。理由：改工具 schema + manager 竞态 + 工具面收敛 + 真实 Pi 回归 + spec 重写，不是 ff 量级。

---
kind: issue
title: "bash 覆盖 + waitSeconds：单工具统一前台/后台命令执行"
type: feature
status: open
created: 2026-09-10
---

# bash 覆盖 + waitSeconds：单工具统一前台/后台命令执行

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。

## 做成以后是什么样

模型只有一个命令执行入口 `bash(command, timeout?, waitSeconds?)`。不传 `waitSeconds` 时行为与内建 bash 完全一致；传了则在同步等待与后台运行之间自动切换：等待期内退出→内联返回输出，超期→转后台、返回 task id、退出自动通知。`background_run` 工具消失，被 `waitSeconds: 0` 收编；`background_status` / `background_kill` / `/background` / footer / 通知机制保留。

**范围：** 覆盖 `bash` 与 Windows `powershell`；`waitSeconds` 语义与 `timeout` 交互；删除 `background_run`；065 默认超时注入与覆盖的整合；spec/README 重写。**不包含：** 交互式 stdin/PTY、自定义 workdir/env、输出分页（仍交给内建 `read`）。

**归属：** 独立 issue。来源讨论：`codestable/talks/005-background-terminal-bash-waitseconds.md`；翻转的旧决策：`codestable/issues/039-x-background-terminal-standalone-tools.md` 已确认决策第 1 条（不覆盖内建工具）——用户已确认翻转（2026-09-10）。相关 spec：`codestable/spec/pi-background-terminal/index.md`。

## 为什么现在做 / 当前坏在哪

- 真实使用中模型工具选择困难：要么全走 `background_run`，要么全走 bash，二选一变成掷硬币。
- 根因（talk 005 已论证）：当前工具边界画在"命令要跑多久"上——时长是模型无法预测的；模型每次调用真正确定的只有"要不要阻塞"。
- 现状缺陷：后台任务没有任何超时兜底，挂死任务无声（永远 running、永远没有通知）；`background_run` 描述里的 "long builds/tests use me" 是预测轴措辞，主动教坏。

## 现状怎么工作

内建 `bash(command, timeout?)` 同步执行，无默认超时（065 ff 用 `tool_call` 钩子注入 600s）；`background_run(command)` 立即转后台，无超时上限；退出经 `followUp + triggerTurn:true` 唤醒，忙碌期缓冲到 `agent_settled`；输出落盘 `$TMPDIR/pi-background-terminal/<id>.log`。

## 动哪些、验哪些

- **必须改**：`src/index.ts`（注册 bash/powershell 覆盖，改注册三工具为两工具）；新建 `tools/shell-override.ts`（组合 schema + execute 分派）；`tools/background-run.ts` 删除；`bash-default-timeout.ts` 与覆盖整合（带 `waitSeconds` 的调用跳过 600s 注入；`timeout` 语义变为总寿命硬杀）；`background/manager.ts`（暴露"等待竞态"入口，内联返回路径的输出读取与截断）；README、spec。
- **需要验**：不传 waitSeconds 与内建逐字节一致；竞态三边界（等待中退出 / 转后台瞬间退出 / `timeout ≤ waitSeconds` 时同步等死与转后台后等死的行为定义）；转后台路径的通知契约不回退；真实 Pi 回归（普通命令、dev server、快路径内联返回、自动唤醒）；`/reload` 存活回归。
- **仍未知**：`timeout ≤ waitSeconds` 时等待期到达 `timeout` 的行为选择（等价同步超时报错 vs 转后台后 timed_out 通知）——实现时定，倾向前者（模型还在等，错误就地可见）。

## 方案与实现安排

- **组合不重写**：schema 从 `createBashToolDefinition()` 的定义运行时组合（追加 `waitSeconds`）；默认路径直接调用内建 execute 转发（038 验证过委托路径）；waitSeconds 路径复用 `createLocalBashOperations().exec()` + 现有 manager（`exec` 原生支持 `timeout` 与 `AbortSignal`）。render 沿用内建（覆盖工具不注册自定义 renderCall/renderResult，Pi 按文档回退内建渲染器）。
- **语义**：`waitSeconds` 省略 = 纯前台（同今天）；`0` = 立即转后台；`N>0` = 同步竞态。`timeout`（若设）= 总寿命硬杀，覆盖同步与后台两段；不设则后台任务不限寿命。
- **风险与穿刺**：schema 遮蔽靠组合 + peer 下限 + changelog 跟踪；bash 覆盖失败/包卸载自动回退内建。第一刀先穿刺「覆盖注册 + 纯委托」证明零行为差异，再加 waitSeconds 分支。
- **质量承诺**：兼容性/隔离性（默认路径零差异）；功能正确性（竞态边界）；性能效率（零轮询、通知驱动不变）；可维护性（无手抄 schema 副本）。

## 验证

- 单测：默认委托路径（不传 waitSeconds 时与内建 execute 同参调用）；waitSeconds=0 等价旧 background_run；N>0 快路径内联返回（含截断）与慢路径转后台；`timeout` 在转后台后到点必死（timed_out 状态 + 通知）；带 waitSeconds 跳过 600s 注入；既有 manager 回归全绿。
- 真实 Pi 非交互回归（自然语言不提示工具名）：普通命令只走 bash 且行为不变；明确"别等它"的命令得到 task id；"等一下但别卡死"的命令在慢时得到转后台+后续通知；dev server 不被 600s 杀死；`/reload` 后任务仍可见可停。
- `npm pack --dry-run` 干净；全仓 typecheck + test。

## 执行记录

（实现阶段追加）

## 关闭时

- 回写候选：`codestable/spec/pi-background-terminal/`（三表面重写为 bash 覆盖 + 两工具 + 菜单；waitSeconds/timeout 语义、翻转 039 的理由）；根/包 README；能力地图 `codestable/spec/index.md`。
- 关闭判断与验证摘要：兼容性（默认路径零差异证据）、正确性（竞态边界测试）、通知契约不回退。
- 遗留：如有——同 override 冲突的 README 声明是否足够。

---
kind: issue
title: "纯后台定调：删全部等待路径，恢复 background_run 诚实名"
type: feature
status: closed
closed: 2026-09-14
created: 2026-09-14
---

# 纯后台定调：删全部等待路径，恢复 background_run 诚实名

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。

## 做成以后是什么样

包只做纯后台执行：`background_run(command, timeout?)` 立即返回 task id，命令脱手运行，退出时 followUp 唤醒。bash 是前台执行器（原生、零触碰），本包工具无任何前台等待能力。选择轴从"预测时长"变为"要不要结果"——模型自己的知识。

**范围：** 删除 wait-then-demote/oneShot/inline 全部等待路径（manager 的 runWithWait/inlineResult/readTail/notifyOnSettle + 工具的 waitSeconds）；`run` 改名 `background_run`；timeout 保留 600s 默认 + dev-server 逃逸口；spec/README 重写；0.8.0。**不包含：** PTY、覆盖内建工具、可配置默认值。

**归属：** 独立 issue。决策链：039（三工具不覆盖）→ 071（覆盖 bash+waitSeconds）→ 077（双默认）→ 078（解耦 + `run`）→ **本 issue（纯后台定调，覆盖 078 的 wait-then-demote 形态与 `run` 命名）**。

## 为什么（用户 2026-09-14 定调）

1. "既然 bash 还存在，给的工具就不要留前台运行能力——专注后台命令。"
2. 选择轴修正：078 的"可能超过几秒"仍是时长预测的残留；"要不要结果"才是模型确定知道的事。需要结果（哪怕 20s）→ bash 阻塞等；脱手 → background_run。
3. 命名消解：talk 005 的"名字撒谎"批判只成立于带快路径的工具；纯后台工具叫 `background_run` 是诚实名，家族 `background_run/status/kill` 一致。078 的 `run` 名字反而看不出能力，全靠 description。

## 方案

- `src/tools/background-run.ts`：schema `command`（必填）+ `timeout?`（默认 600s 总寿命）；execute 直接 `manager.start()`；返回 id + 输出文件 + 通知承诺。`resolveShellOptions` + `sessionEnv`（PI_* + agent-bin PATH）从 078 的 run.ts 继承。
- manager 手术：删除 runWithWait/inlineResult/readTail/notifyOnSettle/appendStatus 与死 imports（truncateTail/DEFAULT_MAX_BYTES/formatSize/AgentToolResult/BashToolDetails/INLINE_READ_CAP）；保留 spawn/文件上限/通知编排/sweep/globalThis 钉。
- print/JSON 无需特判：无等待即无 one-shot 问题，fire-and-forget 全 mode 一致，任务随进程死（进程同生共死不变式不变）。
- hook（bash+powershell 600s）与 `/background`、`background_status`、`background_kill` 照旧。

## 验证

- 单测 47 全绿（run.test.ts 重写为 background-run.test.ts 7 场景：schema、立即返回不阻塞、恰一次通知、600s 默认+显式覆盖、timed_out 硬杀、PI_SESSION_ID、PATH 前缀）；typecheck 0 错；pack 干净。
- 变异验证三项全杀：默认 600 移除 → 1 红；PATH 前置移除 → 1 红；hook bash 覆盖移除 → 1 红。
- 真实 Pi 回归（0.85.1，glm-5.3-flash，自然语言不提示工具名）：
  - S1 快命令（echo）→ 模型选原生 `bash`。
  - S2 需要结果的慢命令（sleep 20 + "I need the result before we continue"）→ 模型选 `bash` 阻塞 20s 拿结果——新选择轴的核心验证。
  - S3 hands-off（"long test suite, I don't need to wait"）→ 模型裸参 `background_run`，立即返回，退出唤醒带 exit code + 末行，模型汇报结果。
  - S4 dev server（"NOT killed by any default timeout, don't block"）→ 模型自主 `timeout: 86400`；SIGTERM 杀 pi 进程后 node 任务同死（ps 复查零幸存；初扫的"幸存者"是测试脚本自身进程，与前次相同排除法）。

## 执行记录

### 2026-09-14 实现

- `background-run.ts` 新建（继承 078 run.ts 的 settings/env 基建，删 wait/oneShot 分派）；`run.ts`/`run.test.ts` 删除/重写；`shell-override.ts` 已于 078 删除。
- manager 手术（python 脚本精确删除四个死方法 + 死 imports + INLINE_READ_CAP），runWithWait 引用清零（grep 验证）。
- index.ts 注册三工具；index.test.ts 断言三 background_* + 显式 not bash/powershell。

### 2026-09-14 审计轮（独立 reviewer，面向 LLM 提示词工程 + 代码质量）

Verdict：OK with notes，7 条发现全部处置：

- **P1 package.json 描述过期**（还在描述 077/078 的 bash 覆盖设计）→ 重写为纯后台描述。
- **P1 bash 超时失败路径无引导**：模型 bash 600s 超时后看到的错误没有指向 background_run 的恢复提示（bash 自己的 description 无法提及本包工具）→ promptGuidelines 增加第五条：bash/powershell 默认也被 600s 硬杀，需要更久用 background_run 传大 timeout。
- **P2 逃逸口运行时强化**：工具结果文本现回显 `Hard timeout: Ns`；timeout schema 描述加入 dev-server 示例；`timed_out` 唤醒消息附带恢复提示（"restart with background_run and a larger timeout"）。
- **P2 部分输出误读风险**：启动结果声明 "until then the output file is partial"；background_status 运行中任务的 tail 前缀改为 "Output so far (still running)"。
- **P2 手术残留**：删除无人使用的 `suppressNotify` 选项；修正三处过期注释（startAndWait 引用、foreground 字样、不存在的 run 工具）。
- **P2 timeout 无 schema 上限**：加 `maximum: 2147483` 对齐内建 bash 的 2^31-1ms 上限，防超大值进入 spawn 才报错。
- **P2 print 模式诚实化**（审计标记 unverified，本会话早前已实证）：README "works identically in every session mode" 改为如实描述——pi -p 进程随 turn 退出，任务在退出通知前死亡；代码注释同步。

审计确认无需改动的：选择轴双方向引导完整、promptSnippet/guidelines 用法符合 pi 约定（对照 system-prompt.js/types.d.ts 核实）、三通道反轮询、唤醒消息可操作、kill 竞态已处理、README 与代码一致性。审计建议的更强方案（tool_result 钩子动态追加超时引导）未采纳：guideline 已覆盖发现路径，等真实使用证明需要再加。

修复后：47 测试全绿、typecheck 0 错；真实回归（同一轮双意图分拆：hands-off → background_run + 即时 → bash 内联）确认引导无回退。

名字问题上先跑了真实选择实验（run/background_run/exec/shell 四名 × 四场景），中途用户定调"纯后台"——实验目标消失（纯后台工具名回归 background_run，无需再对比）。实验脚本已清理。

## 关闭时

- 回写：spec 全文重写（纯后台定位、选择轴、进程同生共死不变式、决策链 039→071→077→078→079）；README 重写。✅ 已完成。
- 关闭判断：四场景真实回归通过（选择轴生效 + 机制无回退）。✅ 已验证。

---
kind: issue
title: "subagent 纯后台：删前台路径，进度搬到状态栏与 /subagent 菜单"
type: feature
status: open
created: 2026-09-17
---

# subagent 纯后台：删前台路径，进度搬到状态栏与 /subagent 菜单

> 来源：`byissue/talks/007-background-wait-model-and-positive-prompting.md`；判据：`byissue/decisions/001-positive-first-prompting.md`。

---

## 做成以后是什么样

- `subagent(...)` 调用**立即返回** task id，永远不阻塞父回合；完成后经 `followUp + triggerTurn` 送达完整输出（现有后台通知机制）。`async` 参数删除（schema 中不再出现；旧调用传了也忽略）。
- 状态栏在有任务运行时显示简略进度：数量 + 最老任务的角色/耗时，例如 `sub:2 · reviewer 1m20s`；全部结束清除。
- `/subagent → View Active Subagents → 某任务` 显示与今天前台相同的详细进度卡（spinner、耗时、思考意图、活跃工具、token/费用），复用 `renderProgressCard`。
- 用户在 subagent 运行期间可以正常输入、steer 主 agent。

**范围：** 包含 `packages/pi-subagent` 的工具 execute 路径、manager 记录、状态栏、菜单单任务页、README/spec 同步；不包含 chain/并发语义、模型/思考优先级、子进程协议的任何改变。

## 为什么现在做

模型几乎从不主动传 `async: true`，前台阻塞让用户几分钟不能插话。后台通知已携带全文输出（`formatSubagentExitMessage`），前台没有信息优势——它唯一的独有价值是实时进度卡，而进度卡可以搬家。这是 079（background-terminal 纯后台）同一逻辑在 subagent 上的推演：结果由通知送达，"要不要阻塞"这根轴塌缩。

## 现状怎么工作

`execute` 按 `isAsync` 分两条路（`src/index.ts` ~1735 起）。前台路径把 `onUpdate` 传给 `runSubagent`，流式产出 `ProgressDetails`（`kind: "pi-subagent-progress"`），由 tool 的 `renderResult` 渲染成卡片；后台路径传 `undefined`，只在 `subagentManager` 记 status/output，状态栏 `sub:N`，菜单只能看最终 output。

## 方案

1. **一份数据**：后台路径也传 `onUpdate`，把最新 `ProgressDetails` 写进 `SubagentTaskRecord`（新增字段 `progress?`），写入时调 `updateStatus`。`toMessageDetails()` 继续剥掉不可 clone 字段（ff 073 不变式）。
2. **两个视图**：
   - 状态栏：从 manager 取运行中任务，格式化为 `sub:N · <agent|task 前缀> <elapsed>`；只显示最老一个，宽度守住。
   - 菜单单任务页（`command.ts viewSingleTaskMenu`）：running 时加 "📊 Progress" 动作，用 `renderProgressCard(record.progress, expanded=true, width)` 输出到 `ctx.ui.editor` 或 notify；已结束时保留 View Output。
3. **删前台**：删 `fgRecord`/同步分支、`renderCall`/`renderResult` 的进度分支（tool 结果只剩一行 "started" 文本）、`Alt+O` 快捷键与 `rememberNativeCard`（若无其他用途）、`async` 参数及 `input.background` 兼容。
4. **提示词**：工具 description / promptGuidelines 按 decision 001 写正向动作（ff 087 已铺底："after it starts, continue other work or end your turn; the result arrives as a new message"）。
5. **print 模式**：接受结果随进程丢，spec「明确不做」记一行；无回落分支。

## 风险与验证

- 风险：状态栏刷新频率——`onUpdate` 很密，需节流（例如 ≥500ms 或仅在 elapsed 秒数变化时刷）。
- 顺手：退出通知标题的 `description` 由 `trunc(task, 60)` 生成，会截在路径中间且带 `[0m…[0m` 转义残留（talk 007 测试实录）；改为优先 `agent` 角色 + 任务首句、纯文本截断。
- 风险：`ProgressDetails` 进入 manager 记录后，`session_shutdown` 清理与 `/reload` 存活是否仍正确。
- 验证：`npm --workspace @bytetrue/pi-subagent test` + `typecheck`；真实 Pi 回归：调用 subagent → 立即返回 → 状态栏出现简略进度 → 菜单能看详细卡 → 完成后 followUp 携带全文输出 → 状态栏清除；运行期间用户输入不被阻塞。
- 更新 `byissue/spec/pi-subagent/index.md`（当前表面、核心机制 3/4、使用路径）与 README。

## 关闭时

- 回写 spec：subagent 无前台模式；进度双视图；print 模式明确不做。
- 遗留候选：pi-image-gen SKILL 措辞（见 talk 007 暂不纳入）。

---
kind: issue
title: "subagent 纯后台：删前台路径，进度搬到状态栏与 /subagent 菜单"
type: feature
status: closed
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

## 执行记录

- `src/index.ts`：execute 只剩后台一条路（返回一行 started 文本 + `{id,status,count,chain}` details）；后台路径传 `onProgress`，把 `ProgressDetails` 经 `subagentManager.setProgress()` 写进记录（running 之后的迟到更新忽略）；删除 `async`/`background` 参数与 `isAsync`、前台分支、`renderCall`/`renderResult`、`nativeCards`/`rememberNativeCard`/`activeSubagentToolCallId`、`Alt+O` 快捷键、`tool_result` isError 钩子、`mode` 字段。新增 `describeTasks()`（纯文本、角色前缀、`oneLine` 截断，修掉通知标题的 ANSI 残留）和 `formatSubagentStatus()`（`sub:N · <agent> <elapsed>`，取最老 running）。`renderProgressCard` 导出并去掉 Alt+O 提示行。状态栏加 1s ticker（`unref`，idle 清除，`session_shutdown` 清除）。`toMessageDetails` 追加剥 `progress`。
- `src/command.ts`：任务列表去掉 fg/bg 标记；单任务页新增 "📊 View Progress"（有 `progress` 时），复用 `renderProgressCard(progress, expanded=true, columns-4)`；running 时隐藏 View Output（此时必空）。抽 `showText()` 复用 editor/notify 回落。
- `src/index.test.ts`：删 async/mode 断言；新增 schema 无 `async`、无 `renderResult`；`formatSubagentStatus`（最老任务 + idle 为 undefined）；`setProgress` 在 running 时生效、完成后忽略；`describeTasks` 纯文本。22 用例通过，typecheck 通过。
- `README.md`：重写定位、特性、参数表；删 `async` 示例；print 模式一句「明确不做」。
- 与方案偏差：状态栏节流用 1s ticker 而非按 elapsed 变化判断——更简单，代价可忽略。

- 回归中发现并修复两处：
  1. **reload 旧原型**：manager 实例钉在 globalThis 上，升级后 reload 拿到旧类实例，`setProgress is not a function` 直接让任务 failed。改为钉 `Map`、类每次加载新建（`new SubagentTaskManager(globalStore[KEY] ??= new Map())`）；加测试"两实例共享 Map、第二个有新方法"。沉淀 `notes/009`。
  2. **用户反馈进度卡太简略**（只显示末 8 条工具 + 48 行上限，聊天内嵌卡时代的限制）：先尝试全量列出工具调用，用户看后否决（几十行路径同样被截、信息密度低）；中途试过改为 `pi --session <id>` 短命令，用户明确要文件路径；定稿为**卡片保持原样 + 末尾 session log 文件路径**：`~` 缩写、单独一行，放不下时按最后 `/` 拆目录行 + 文件名行（之前按字符硬折导致用户只复制到半截）。通知里给完整路径。新增 `sessionLogPath()` 定位子会话 jsonl（复刻 pi 未导出的 cwd 编码），完成通知附 `Session log(s)` 列表——完整模型行为历史一键可达。`renderProgressCard` 去掉 `expanded` 参数（collapsed 路径无消费者）。
  3. **`ctx.ui.editor` 不适合做进度视图**（是输入框、不实时、长行截断）：新增 `progress-view.ts`，用 `ctx.ui.custom` 做 500ms 重绘的实时视图，↑↓/PgUp/PgDn 滚动、Esc 返回；补声明 `@earendil-works/pi-tui` peer（`tui-picker.ts` 早已直接 import）。视图高度随内容增长会留残影（pi-mcp 4b0cfd3 同款坑），改为固定 16 行视口补空行。

## 验证

- 单元：`npm --workspace @bytetrue/pi-subagent test` 24 passed；`typecheck` 通过。
- 真实 Pi 回归（待 reload）：调用 subagent → 立即返回 → 状态栏 `sub:1 · scout 3s` 并每秒刷新 → `/subagent → 任务 → View Progress` 显示详细卡 → 完成 followUp 携带全文 → 状态栏清除。

## 关闭结论

- 用户多轮 reload 真实回归验收通过：调用立即返回、状态栏 `sub:N · scout Ns`、View Progress 实时视图、完成通知全文 + session log 路径。
- 回写 `byissue/spec/pi-subagent/index.md` 已完成（当前表面/核心机制/明确不做/使用路径）；notes/009 沉淀 reload 钉 Map 模式。
- 遗留：无（print 模式按明确不做处理）。

## 关闭时

- 回写 spec：subagent 无前台模式；进度双视图；print 模式明确不做。
- 遗留候选：pi-image-gen SKILL 措辞（见 talk 007 暂不纳入）。

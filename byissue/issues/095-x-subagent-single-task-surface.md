---
kind: issue
title: "subagent 单任务表面 + 控制工具:砍 tasks[]/chain,新增 status/stop"
type: feature
status: closed
created: 2026-09-21
---

# subagent 单任务表面 + 控制工具:砍 tasks[]/chain,新增 status/stop

> **读者:** 跨会话接手的人——把 `subagent` 工具从"一次调用批量/链式跑 N 个任务"改成"一次调用 = 一个 subagent",并行回归模型在同一消息里发多个 tool call;同时补上控制回路(`subagent_status` / `subagent_stop`),对齐 background-terminal 三件套。

---

## 做成以后是什么样

- `subagent(params)` 入参扁平:`{ task, agent?, tools?, cwd?, resume?, id?, timeoutMs?, maxTurns? }`,`task` 必填;`tasks[]`、`chain`、`mode`、`prompts` 全部消失。1 call = 1 subagent = 1 manager 记录。
- 并行 = 模型在同一条 assistant 消息里发多个 `subagent` tool call,各自立即返回、独立子进程、独立进度卡;退出通知在 agent 忙时经 `pendingExits` 合并。
- 新增 `subagent_status(id)`:运行中返回状态 + 活动摘要(思考意图/当前工具/轮次/token/费用 + 最近 5 条工具 + session log 路径);已结束返回状态不贴 output(全文由 followUp 送达);找不到 id throw。description 写明完成自动通知、不要轮询。
- 新增 `subagent_stop(id)`:停止运行中任务(幂等:已结束返回 "nothing to stop");停止后照常发 "was cancelled" followUp。两工具按 parent session 过滤,不跨会话。
- 立即返回 details 收敛为 `{ id, status }`(删 `count`/`chain`)。
- 版本 0.9.0,`feat!` 破坏性变更。

**范围:** `packages/pi-subagent`(src/README/测试)+ `byissue/spec/pi-subagent/index.md` 回写;不包含 background-terminal、pi core、/subagent 菜单结构(仅随描述文案微调)、模型/思考优先级链(README 里两处 "chain" 是优先级链语义,不误删)。

## 为什么现在做

`tasks[]` 批量是前台阻塞时代的产物:一次调用摊平 N 个任务的阻塞往返。088 纯后台后每次调用立即返回,批量只剩副作用:多任务挤一条 manager 记录 → 状态栏说谎(图中 `sub:1` 实际 2 个子进程)、进度卡套 "2 tasks (parallel)" 壳、完成通知聚合拼接。`chain` 依附于 tasks[](单任务无链),其"中间结果不唤醒父会话"的唯一价值在父会话成为编排者后反变为可观察性优势。同时模型只能"发射"不能"看/停",控制回路缺一半——bg-terminal 的 run/status/kill 三件套是现成同构参照。

## 现状怎么工作

`normalizeTasks`(index.ts ~1167)把 `tasks[]`/`task`/legacy `prompts` 归一为 `SubagentTaskItem[]` + `isChain`;`runSubagent`(~1384)isChain 分支串行传 `prev` 输出,并发分支 `Promise.all` 后 `aggregated` 拼接;`ProgressDetails.runs` 数组贯穿进度渲染(295-430)与 `toMessageDetails`(~573)。工具 schema `required: ["tasks"]`,execute 注册单条 record(describeTasks 生成复数描述,details 带 count/chain)。

## 动哪些、验哪些

- 必须改:`index.ts`(normalizeTasks/describeTasks/runSubagent/schema/execute/1122 resume 提示/legacy 兼容/MAX_PARALLEL_TASKS)、`command.ts:351` resume 提示、`index.test.ts` 对应用例、README、spec。
- 需要验:单任务全路径(启动→状态栏→进度卡→followUp);多 tool call 并行;status/stop 幂等与 session 过滤;`subagent_stop` 走通 `controller.abort() → cli.kill → complete → cancelled followUp`(与菜单 Stop 同路)。
- 仍未知:无——stop 路径已确认(signal 监听 + SIGKILL 宽限已存在)。

## 方案与实现安排

- `SubagentInput` 扁平化;`normalizeTasks` → 单任务归一(保留 `id` 字段现状支持);删 `isChain`/`MAX_PARALLEL_TASKS`/legacy `prompts`/`mode`。
- `runSubagent` 只剩单 run 路径;`details.runs` 保留数组形状恒为单元素——`renderProgressCard`/`progressState`/`toMessageDetails` 等整套渲染与消息代码零改动(六处复数形态不动,代价可接受)。
- `describeTasks` 简化为单任务形态(去 isChain 参数与复数分支)。
- `ProgressDetails.mode` 字段删除,`modeLabel`(413)删除。
- 新工具直接读 manager record + `record.progress`,stop 走 `record.controller.abort()` + `manager.stop()` 同路;session 校验用 `record.parentSessionId !== ctx.sessionManager.getSessionId()` → 当不存在处理(throw/幂等文案),避免跨会话泄漏。
- 工具 description 按 decision 001 正向措辞(status:"completion is reported automatically, so don't poll")。

## 验证

- `npm --workspace @bytetrue/pi-subagent test` + `run typecheck`。
- 新增/改写用例:schema 无 tasks/chain、单任务 normalize、status 各状态文案、stop 幂等与跨 session 拒绝。
- 真实 Pi 回归(用户 reload 验收):单任务启动→状态栏→进度卡→followUp;同消息两个 subagent call → `sub:2` 双卡;status 查询;stop 中途取消 + cancelled 通知。

## 执行记录

- 2026-09-21:立 issue,实现完成。
- `src/index.ts`:
  - `SubagentInput` 扁平为 `SubagentTaskItem` 的类型别名(`{ task, agent?, tools?, cwd?, resume?, id?, timeoutMs?, maxTurns? }`);删 `tasks[]`/`chain`/legacy `mode`/`prompts` 字段。
  - `normalizeTasks` → `normalizeTask(input)`(校验 `task` 非空、只拷白名单字段，model/thinking 永不透传)；`describeTasks(tasks, isChain)` → `describeTask(item)`;删 `MAX_PARALLEL_TASKS`。
  - `runSubagent` 只剩单 run 路径：删 isChain 分支、Promise.all 多路与 `aggregated` 拼接；`details.runs` 保留数组形状恒为单元素(渲染/消息代码零改动);`ProgressDetails.mode` 字段删除，进度卡 header 去掉 `modeLabel`。
  - 工具 schema 扁平(`required: ["task"]`)，立即返回 details 收敛为 `{ id, status }`;description 改为单任务措辞并指明“多任务=同一消息多次调用”与 status/stop 兄弟工具；暂停恢复提示改为 `subagent({ resume, task })`。
  - 新增 `subagent_status`(复用 `formatSubagentTaskStatus`:头部行 + Task 行 + 活动/轮次/费用 + 最近 5 条工具(复用既有 `toolBrief`)+ session log 路径；不含 output，running 时附一行“结果自动送达”)与 `subagent_stop`(幂等：已结束返回 “is already …; nothing to stop”;session 过滤经 `findSessionTask` 比对 `parentSessionId`)。
- `src/command.ts`:resume 提示代码换单任务语法。
- `src/index.test.ts`:normalize/schema/describe 用例改写；schema 用例改为收集全部注册工具并断言三件套 `[subagent, subagent_status, subagent_stop]`;新增 status 格式化(各状态、不泄漏 output)与 status/stop 行为用例(跨 session 拒绝、stop 幂等且 abort controller)。
- `README.md`:定位、特性、三工具参考、示例重写；保留优先级链两处 “chain” 语义。
- `package.json` 0.8.2 → 0.9.0,lockfile 同步。
- 验证:`npm --workspace @bytetrue/pi-subagent test` 28 passed;全仓 `npm test` 117 passed / 9 skipped;typecheck 通过。
- 与方案偏差：无实质偏差；`toolBrief` 直接复用既有实现(原以为要新写)。
- 回归反馈(同日)：用户指出状态栏只显示最老任务(`sub:2 · scout 22s`),但单任务表面下每条记录都是真实子进程，应逐个显示。`formatSubagentStatus` 改为每个 running 任务一格 `agent elapsed`(最老优先)，上限 3 个后缀 `+N more` 守住 footer 宽度；新增截断用例，29 passed。

## 关闭结论

- 目标达成：`subagent` 单任务表面(0.9.0，破坏性变更)、并行回归 tool call 层、`subagent_status` / `subagent_stop` 控制回路补齐，用户真实 Pi reload 验收通过。
- 验证摘要：单元 29 passed + 全仓 117 passed / typecheck 通过(静态)；真实回归六项全过(并行 sub:2 双卡、status 活动/工具/log 路径、stop 幂等、cancelled/完成通知格式)。
- 回写位置:`byissue/spec/pi-subagent/index.md`(定位、当前表面三工具、核心机制单任务执行、明确不做批量/链式、使用路径表)。
- 遗留：无。

## 关闭时

- 回写 spec:工具表面(3 tools)、单任务语义、并行=多 tool call、明确不做(批量/链式不回归)。
- 关闭判断与验证摘要:关闭时补。
- 遗留:无。

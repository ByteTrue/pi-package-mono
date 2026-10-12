---
kind: issue
type: feature
status: closed
created: 2026-10-12
closed: 2026-10-12
---

# 115 · subagent：把子会话指针写进 transcript，让 BySpace 能从磁盘重建子代理时间线

## 目标

BySpace 的 pi 子代理面板在 daemon 重启后永远空白转圈：descriptor 从父 transcript 回放（还停在 running），timeline 却只有 daemon 内存这一份，重启即丢；想从子会话 jsonl 重建，又不知道子任务对应哪个文件。

根因是**父 transcript 不自描述**：extension 在 exit 消息和 tool result details 里都没有写子会话指针（`sessionId` / `sessionFile` / `cwd`），这些事实只活在 `progress.runs[0]` 里，而 `progress` 被 `toMessageDetails()` 有意剥掉（structuredClone 兼容，见 pi-subagent spec 核心机制 3 的不变式）。

本 issue 让 transcript 把指针落盘：

1. **launch record**：`subagent` tool result details 从 `{ id, status }` 扩为 `{ id, status, sessionId, cwd }`；
2. **exit/status/stop details**：`toMessageDetails()` 保留 `sessionId` / `cwd` / `sessionFile` 三个纯数据字段。

全部字段是 clone-safe 字符串，不触碰 pi-subagent spec 核心机制 3 的不变式（details 必须是纯数据，`toMessageDetails()` 剥活对象）。BySpace 侧的回放重建（server）是独立工作，在 byspace 仓库另立 issue；本 issue 只保证「指针在 transcript 里存在」。

**不做单独的 `subagent-started` 兜底消息**（设计阶段曾计划，实现时砍掉）：subagent 是纯后台工具（088），`execute` 立即返回、tool result 几乎即时落盘——崩溃时 launch result 几乎总在 transcript 里，指针随它落盘已覆盖全部现实场景；唯一漏窗是「tool call 与 result 落盘之间被杀」的毫秒级窗口，而那时 BySpace 回放连 descriptor 都配不成（`replayPiSubagentObservations` 要求 toolCall 与 toolResult 配对），没有行就没有空白面板，不需要指针。且 pi core 的 `convertToLlm` 对 custom 消息不看 `display`，一律转 user 进 LLM 上下文——单独的 started 消息等于每次启动给模型塞一行噪音。两害相权，launch details 足够。

旧 transcript 没有指针，救不回来——用户已确认接受。

## 背景与证据

- BySpace 诊断（2026-10-12，shrewd-squid worktree 会话）：`ProviderSubagentStore` 是裸 `InMemoryAgentTimelineStore`，无 durable 层、无回放重建；BySpace 对 pi 子代理 timeline 的唯一生产路径是 `PiSubagentSessionTailers` tail 子会话 jsonl，其输入完全来自扩展 loopback report（`BYSPACE_SUBAGENT_REPORT_URL` + `BYSPACE_SUBAGENT_REPORT_TOKEN`），daemon 重启后 report 停止、指针丢失。
- 指针的现存生产点：`runSubagent` 在 spawn 时 `state.cwd = targetCwd`（index.ts:1192），session id 在 `runSubagent` 开头即确定（`item.resume || item.id || sub_${randomBytes(6)}`，index.ts:1821）——**launch 时刻三个字段全部可得**，不必等 report。
- `sessionLogPath(run)`（index.ts:369）复刻 pi 未导出的目录编码规则定位 jsonl；launch 时文件可能尚未创建，`readdirSync` 返回 undefined，所以 launch details 只写 `sessionId` + `cwd`，`sessionFile` 留给 exit 与 report。
- 对照：Claude 的 provider 子代理 sidechain transcript 存在父会话目录下，replay 可从磁盘重建（byspace docs/agent-lifecycle.md）；pi 是唯一断链的 provider。

## 现状如何工作

- `subagent` tool result：`details: { id: taskId, status: "running" }`（index.ts:2130）。BySpace `observePiSubagentLaunch` 读这个 details + tool call args 得到 descriptor。
- **execute 的 `taskId` 与子会话 `sessionId` 是两个独立随机 id**：execute 生成 `taskId = sub_<hex>`（manager 记录键），`runSubagent` 内部另生成 `sessionId = item.resume || item.id || sub_<hex>`（子进程 `--session-id`）。launch details 要带真指针，必须 execute 预生成 sessionId 经 `input.id` 注入 `runSubagent`（`normalizeTask` 仍接受 `id`，只是不进 schema）——注意 `input.resume` 存在时不能注入（`--session` 与 `--session-id` 会同时指向同一 id，pi 行为未验证），此时 sessionId 就是 resume 值，无需注入。
- `subagent-exit` custom 消息与 `subagent_status` / `subagent_stop` tool result：`details = toMessageDetails(task)`（index.ts:2176/2213/2224），剥掉 `controller`/`done`/`notifyOnExit`/`progress`——`sessionId` 恰好在被剥掉的 `progress.runs[0]` 里。
- `byspaceReporter.report(buildByspaceReportRecord(task, sessionLogPath))`（index.ts:1948）是唯一把指针交给 BySpace 的通道，纯内存生命周期。

## 操作方案

`packages/pi-subagent/src/index.ts`：

1. `subagent` tool 的 execute：`normalizeTask` 之后预生成 `childSessionId = item.resume || item.id || sub_<hex>`；`item.resume` 为空时以 `{ ...input, id: childSessionId }` 调 `runSubagent`（resume 非空则原样传，sessionId 即 resume 值）。launch details 扩为 `{ id: taskId, status: "running", sessionId: childSessionId, cwd: <resolve 后的目标 cwd> }`。cwd 在 execute 侧用与 `runPi` 相同的规则解析（`item.cwd ? resolve(item.cwd) : cwd`），不等 spawn——result 返回时子进程可能尚未启动。不带 `sessionFile`：launch 时刻 jsonl 可能还没建，BySpace 拿 sessionId+cwd 自行定位（其 `locatePiSubagentSessionFile` 本来就做这件事）。
2. `toMessageDetails()`：解构排除表不变，从 `task.progress?.runs[0]` 提取 `sessionId` / `cwd`，`sessionFile = sessionLogPath(run)`（exit 时刻文件已在），三键缺证据就不写键。
3. `byspace-report.ts` 的 report 记录形状不变（它已带指针）。

BySpace `agent-subagents.ts` 的 `parsePiSubagentRecordDetails` 已按「wrong-typed 字段读作 absent」设计，新增键对旧 BySpace 前向兼容；旧扩展对新 BySpace 也兼容（键缺失 = 读不到，走现有兜底）。

## 明确不做

- 不改 BySpace server/app（另立 issue）。
- 不做 timeline 持久化或回放重建（同上）。
- 不动 `progress` 的剥除规则（spec 核心机制 3 不变式）。
- 不为旧 transcript 补指针（用户确认放弃）。

## 验证

- `npm --workspace @bytetrue/pi-subagent test`：`toMessageDetails` 剥除测试加断言——保留的三键存在且来自 runs[0]；无 progress 的 task 不带这三键；structuredClone 仍不炸。
- launch details：execute 测试断言 details 含 `sessionId`（与传给子进程 `--session-id` 一致）与 `cwd`；resume 调用时 sessionId 等于 resume 值。
- 真实 Pi 冒烟：跑一个 subagent，`grep` 父会话 jsonl 确认 launch tool result details 带指针；父会话继续对话正常（无 structuredClone 异常）。

## 执行记录

2026-10-12 实现，与方案一致，一处方案内修正（见上「不做 subagent-started」段——launch result 即时落盘使兜底消息多余）：

- `toMessageDetails()`：剥除表不变；`progress?.runs[0]` 存在时提升 `sessionId`/`cwd`，`sessionFile = sessionLogPath(run)`（readdir miss → 键省略，不报错）。无 run 的 task 原样返回。
- `subagent` execute：`childSessionId = item.resume || item.id || sub_<hex>` 预生成；`item.resume` 非空时原样传 input（不注入 id，避免 `--session`/`--session-id` 双写），否则 `{ ...input, id: childSessionId }`。launch details 扩为 `{ id, status, sessionId, cwd }`，cwd 复刻 `runPi` 规则（`item.cwd ? resolve : process.cwd()`），不等 spawn。
- `byspace-report.ts` 未动（形状已兼容）。

验证：

- `npm --workspace @bytetrue/pi-subagent test`：全包 86/86 过（提交前 97 例 → 101 例，新增 4：toMessageDetails 提升两例、launch details e2e 两例；其他测试文件的既有 13 例不变）。
- `npm --workspace @bytetrue/pi-subagent run typecheck`：过。
- e2e 探针用 fake pi CLI（`PI_CLI_JS`）验证：launch details 的 `sessionId` 与子进程实际 `--session-id` argv 一致；resume 调用时 `sessionId` 等于 resume 值；`structuredClone(details)` 不炸。

注：工作区另有 issue 116 的未提交变更（各包版本 bump、pi-vision 测试），与本 issue 无关，提交时不得混入。

## 关闭候选

- pi-subagent spec「核心机制 4」补一句：transcript 自描述——launch tool result 与 exit/status/stop details 都携带 `sessionId`/`cwd`/`sessionFile`，供 BySpace 从磁盘重建子代理时间线。
- ff 073 的不变式描述不受影响（剥的是活对象，保留的是字符串）。

## 对抗性审查（2026-10-12，子代理审查）

**Verdict：可合入。** 代码正确性实证通过（id 注入四组合穷举、structuredClone 安全、兼容性、测试有效性含两轮变异测试），无指针分歧组合。发现并修复的文档层问题：

- 本文件「关闭候选」原承诺了已砍掉的 `subagent-started` 消息（与执行记录矛盾），已改写为 launch tool result + exit/status/stop details。
- 「ff 073」引用悬空（该编号不存在，真实不变式在 spec 核心机制 3），已改指 spec。
- 验证数字口径错误（"原 84 + 新 4" 实为逐文件 97→101、全包 86），已修正。
- BySpace 侧注释版本门与未 bump 的 0.17.0 错位：本包发版时确认 0.17.0 是否已发布，未发布则指针特性随 0.17.0 落地（BySpace 注释的 "0.18" 改为跟随实际版本）。

遗留（不阻塞，后续 issue 候选）：

- `toMessageDetails()` 每次调用同步 `readdirSync`（exit 批量 N 次放大）；可缓存解析结果或加解析开关。
- `sessionLogPath` 的 `find` 无时间戳排序，理论上同 id 多文件可能选错（提交前已有，非本次引入）。
- `resume`+`id` 同传时 `id` 被静默丢弃（提交前已有语义）；可在 schema 层 reject 或文档注明优先级。
- 本提交 commit 主题行过长（shell 转义丢换行所致），格式不合仓库惯例。

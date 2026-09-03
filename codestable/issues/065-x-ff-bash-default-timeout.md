---
kind: issue
title: "内建 bash/powershell 默认超时注入（tool_call 钩子）"
type: ff
status: closed
created: 2026-09-03
---

# 内建 bash/powershell 默认超时注入（tool_call 钩子）

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `codestable/` 有无影响。

---

背景：真实事故——Agent 跑了一条扫根目录的 `find`，Pi 内建 `bash` 默认无超时（schema description 明写 "optional, no default timeout"），卡住数小时。用户原想覆盖 bash（即复活 038 设计），讨论后改选非侵入方案：监听 `tool_call` 事件原地改写入参（Pi 自 0.63.1 文档化行为），给未显式传 `timeout` 的 `bash`/`powershell` 调用注入 `timeout: 600`。显式传参尊重原值；`background_run` 不注入（后台任务本就该长跑）；其他工具不受影响；内建工具从不被覆盖或重注册。

- 改动：
  - `packages/pi-background-terminal/src/bash-default-timeout.ts` — 新模块，注册 tool_call 钩子（~20 行核心逻辑）
  - `packages/pi-background-terminal/src/index.ts` — 注册新模块
  - `packages/pi-background-terminal/src/bash-default-timeout.test.ts` — 5 个用例（注入/显式尊重/powershell/非 shell 工具跳过/background_run 跳过）
  - `packages/pi-background-terminal/src/index.test.ts` — 事件断言加 `tool_call`
  - `packages/pi-background-terminal/README.md`、`package.json` — 新增 "Default shell timeout" 一节，描述更新
- 验证：`npm test` 7 files / 35 tests 全绿；`tsc --noEmit` 通过；`npm pack --dry-run` 干净。真实 Pi（deepseek-v4-pro，`-e src/index.ts` 隔离加载）回归：模型按指令调 `bash {"command":"sleep 700"}` 未传 timeout，600s 时进程被杀并报 `Command timed out after 600 seconds`（注入生效）；另一轮模型显式传 `timeout:700` 被原样尊重。注：当晚上游代理不稳（haiku/sonnet 多次流断/503），回归用 deepseek-v4-pro 完成。
- codestable：已同步 `codestable/spec/pi-background-terminal/index.md`（定位、当前表面、使用路径、实现地图、明确不做、验证、证据）

顺手发现（可选）：`isToolCallEventType` 自 0.51.0 就有、入参 mutation 自 0.63.1 文档化，都远低于 peer 下限 0.80.4，无需动 peer。

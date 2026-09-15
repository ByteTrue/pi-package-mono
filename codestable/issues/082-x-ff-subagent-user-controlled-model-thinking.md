---
kind: issue
title: "subagent 模型与思考强度改为只由用户控制"
type: ff
status: closed
created: 2026-09-15
---

# subagent 模型与思考强度改为只由用户控制

Agent 可见的 `subagent` 工具不再提供 `model` / `thinking` 参数；角色配置、agent 模板、`/subagent` 默认设置与父会话继承仍保留。旧提示或伪造输入即使带上这两个字段，规范化和执行层也会忽略，不能越过用户配置。

- 改动：`packages/pi-subagent/src/index.ts`、`src/index.test.ts` — 收窄 schema、类型与解析优先级，并锁定伪造字段无效。
- 改动：`packages/pi-subagent/README.md` — 删除任务级覆盖文档与示例，说明用户控制的解析链。
- 验证：19 项包测试与类型检查通过；打包预检只含 7 个发布文件；真实 Pi 调用中 tool args 没有 `model` / `thinking`，scout 子进程成功继承 `bytetrueapi/gpt-5.6-sol` 并返回 `INHERIT_OK`；`git diff --check` 通过。
- codestable：已同步 `codestable/spec/pi-subagent/index.md` 的当前工具表面和执行策略。

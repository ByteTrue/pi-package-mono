---
kind: issue
title: "subagent 未知角色名报错：不再静默退化为通用子 agent"
type: ff
status: closed
created: 2026-09-23
---

# subagent 未知角色名报错：不再静默退化为通用子 agent

`agent` 传了不存在的名字（拼错、自造名如 `dogfood`）时，此前 `findAgentDefinition` 返回 `found:false` 空配置，任务照常启动，但子 agent 拿不到请求的角色 systemPrompt/tools——请求方以为派给了专才，实际是无名通用 agent。现在改为**报错**：

```
Unknown agent role "dogfood". Available roles: researcher, reviewer, scout.
Omit 'agent' for a general-purpose child, or use one of the roles above.
```

不吞错、不带病启动，错误文本可被模型直接用于自纠。

- 改动：`packages/pi-subagent/src/index.ts` — 新增导出 `resolveAgentRole(cwd, agentName?, settings?)`：能解析出文档返回其配置；否则若 settings 里显式配置过该角色名（模型/思考绑定）仍接受；都不是则抛错并列出可用角色。工具 `execute` 在注册任务**之前**调用它（坏角色不产生任务记录、不发通知）；`runSubagent` 内部同样经它解析，直接调用者也不会静默降级。`agent` 参数描述补充「匹配不到会报错」。
- 改动：`packages/pi-subagent/src/index.test.ts` — 新增 `resolveAgentRole` 单测（有文档 / 无文档 / 报错文案）与工具级用例（未知角色 reject、不启动任务）。
- 验证：包内 31 项测试全绿、typecheck 通过。真实 pi（`glm-5.3-flash`，`-e packages/pi-subagent/src/index.ts`）强制 `agent: "dogfood"`：tool 返回 `isError:true` + 上述错误全文，模型下一轮据此纠正。
- byissue：已同步 `byissue/spec/pi-subagent/index.md`（当前表面 + `resolveAgentRole` 语义）；README `agent` 参数行同步。

顺手发现（不在本次范围）：`/subagent` 菜单允许给尚不存在的角色名配置 model/thinking；这类「只有 settings 绑定、没有文档」的名字现在可正常通过校验（有单测锁定），但子 agent 没有角色提示词，语义是「通用 agent + 指定模型/思考」——如需更强的配置校验另议。

- 发布：随 `096` 一起发布于 `0.9.1`（2026-09-23，见 `096` 的发布记录）。

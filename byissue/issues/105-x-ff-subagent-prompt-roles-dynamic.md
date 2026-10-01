---
kind: issue
title: "subagent 提示词：动态角色列表注入 + 去掉 only-when 锁死措辞；general-purpose 措辞保留"
type: ff
status: closed
created: 2026-09-30
---

# subagent 提示词：动态角色列表注入 + only-when 锁死措辞去除

**触发（2026-09-30 用户反馈两轮）**：主会话极少主动委派 subagent，review 注入的提示词后：

1. (m00085) rules 第二条 "pass 'agent' only when … matches the job exactly" 锁死自定义角色，删除；提示词保持精练。
2. (m00085) 默认子代理不应被包装成与 explore/plan 并列的"角色选项"。
3. (m00142) 用户追问：模型根本不知道有哪些角色可选，应有类似 list 的机制让模型看到当前角色；同时裁决 full-capable 换皮无意义，改回 general-purpose 措辞。

## 改动（最终态）

- packages/pi-subagent/src/index.ts
  - **动态角色列表**：注册时计算 availableRoles = listDiscoveredAgentNames(process.cwd()) 过滤 DEFAULT_AGENT_NAME，内置角色附 gloss，注入 agent 参数描述："Roles available: explore (fast read-only search, lowest thinking), plan (…), <自定义名>…"。会话中途新增角色由 resolveAgentRole 报错兜底（报错列全量角色，模型一次纠错）。未做独立 list 工具：避免给已不情愿委派的模型增加前置查询调用；列表出现在填参数的决策点。
  - description："Omit 'agent' for a general-purpose default child…"；保留动态角色说明、异步等待模型、并行提示（decision 001 正向措辞）。
  - promptSnippet："…omit 'agent' for the general-purpose default child, or pass a role when one matches…"
  - promptGuidelines：两条（委派动机 + 异步等待模型），only-when 锁死句已删。
  - resolveAgentRole 错误信息："Omit 'agent' for the default general-purpose child, or use one of the roles above."
- packages/pi-subagent/src/index.test.ts：断言 general-purpose 措辞回归；guidelines 不得含 "pass 'agent' only when"（防锁死句回归）；agent 参数描述必须含 "Roles available: " 且匹配 explore/plan（动态列表防回归）。

## 设计决策

- **角色列表注入 vs 独立 list 工具**：选注入。模型填 agent 参数时正好看到列表，零额外调用；list 工具会加前置摩擦。代价：注册时快照，中途加角色看不到——报错兜底覆盖。
- **general-purpose 词保留**：m00085 反对的是把它列为角色选项；描述默认行为的 "general-purpose default child" 措辞经 m00142 用户裁决保留。

## 平衡 issue 096

096 教训（省略 agent 的默认路径必须可见）保留：description / promptSnippet / agent 参数描述三处显式说 omit agent = general-purpose 默认子代理。

## 验证

- npx vitest run（pi-subagent）：54 passed / 54。
- npx tsc --noEmit -p .：通过。
- 本机实测列表：.pi/agents 与 ~/.pi/agent/agents 均不存在，availableRoles 只含内置 explore/plan。
- 未做：真实模型 A/B；发布 bump（需授权）。

## 关闭（2026-09-30）

用户裁决收尾 (m00211)：
- 会话中途新增角色的快照漂移 "我不 care，有没有无所谓" —— 注册时快照 + resolveAgentRole 报错兜底的方案被接受。
- 参数 schema 可见性已核实 (m00210)：pi provider 层 convertTools/buildParams 把工具 description + input_schema 打进 params.tools，随每次 API 请求整体发送——角色列表从第一回合就可见，不存在"模型不知道有角色→走通用流程"的信息缺口。剩余缺口仅会话中途新增角色，用户明确不 care。
- 遗留待办：发布 0.9.x bump 未做（需用户授权）；general-purpose.md 文件名问题见后续候选。

## 后续候选（不在本次范围）

- README "general-purpose by default" 措辞与 agents/general-purpose.md 文件名（牵扯 DEFAULT_AGENT_NAME 加载路径，另开 issue）。
- guidelines 补"何时优先委派"触发条件清单——用户尚未裁决。
- 若模型仍不主动委派，可考虑在 resolveAgentRole 报错之外加独立 list 工具。

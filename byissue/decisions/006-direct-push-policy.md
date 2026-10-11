---
kind: decision
title: "直推 main 政策：PR 从强制改为默认可选，紧急通道废除"
created: 2026-10-12
superseded-by: ""
---

# 直推 main 政策：PR 从强制改为默认可选，紧急通道废除

2026-10-12 成员拍板：删除「不允许直推 main」的规矩。直接推送/合并到 main 是允许的；PR 与 review 从强制改为默认可选路径（风险大或半成品仍然走 PR）。CONTRIBUTING 原「Every change lands via PR」「Agents have no emergency lane」与紧急通道三步 checklist（授权→登记→24h 补记录）同时废除。

- **取代**：决策 005「后续直推走 CONTRIBUTING 紧急通道登记」的后置约束；005 的历史补录原文保留。
- **branch protection**：确认 GitHub main 分支未设保护（API 404，2026-10-12），无需删除动作；是否将来启用留成员另行决定。
- **agent 边界不变**：agent 直推仍需成员在对话中明确授权该次推送（本次授权：2026-10-12，成员要求 agent 将 `docs/subagent-0.17.0-release-record` 合入 main 并推送）。
- **CI 语义不变**：ci.yml 在每次 push 到 main 时运行，直推同样过 CI，红了就立即修。

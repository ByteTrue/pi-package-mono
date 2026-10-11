---
kind: decision
title: "pi-subagent 只有一个内置角色 reviewer；省略 agent = 裸子会话"
created: 2026-10-11
superseded-by: ""
---

# pi-subagent 只有一个内置角色 reviewer；省略 agent = 裸子会话

内置角色从 `explore` / `plan` / `general-purpose` 收敛为**只剩 `reviewer`**，同时删掉隐藏的默认角色：省略 `agent` 不再注入任何角色提示词，任务原文即子进程 prompt。被排除的方案是保留三角色、或只把 `general-purpose` 降级但仍作为默认模板——两者都让「默认路径」有第二个真相源（那份文档正文）需要同步。依据是本机 52 次符合本包 schema 的调用里 `explore` 1 次、`plan` 0 次，而 `reviewer` 7 次、省略 `agent` 35 次。

## 背景（按需）

这条反转了 issue 100（2026-09-30）的裁决——当时判定 `reviewer` 应出仓、做成独立 skill，本仓库不承接。反转理由：review 是这套工具的实际主用途（干净上下文做对抗性审查），而提示词用本包 0.9.x 的自写版本，不涉及第三方版权文本。

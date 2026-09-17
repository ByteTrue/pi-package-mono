---
kind: decision
title: "面向 LLM 的规则正向优先：否定只保留强默认与安全边界，且必须带替代动作"
created: 2026-09-17
superseded-by: ""
---

# 面向 LLM 的规则正向优先

仓库内所有面向模型的文本（tool description、promptSnippet、promptGuidelines、内置 agent systemPrompt、SKILL.md、工具返回文本）每条规则先说**该做什么**。否定只在两种情况保留：(a) 被禁行为是模型的强默认，不点名就会掉进去；(b) 安全或不可逆边界。两种情况都必须紧跟替代动作。被否决的备选是"全面删除否定"——它会误伤凭据与不可逆 mutation 边界。

## 背景

`background_run` 的 guideline 只写了 "do not poll"，没写"结束回合就是等待"，模型于是用 `sleep` 自阻塞（talk 007）。否定的真正危害不是"提到了大象"，而是删掉一条路却没给替代路，模型会用被禁行为的变体填补真空。

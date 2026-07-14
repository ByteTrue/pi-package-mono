---
doc_type: issue-report
issue: 2026-07-11-web-search-budgets
status: confirmed
severity: P2
summary: 挂起 provider 阻断 fallback，且远端 search 字段与最终结果总量无上限
tags: [web-search, timeout, output-budget, fallback]
---

# web_search attempt / 输出预算 Issue Report

## 1. 问题现象

- active provider 建连后不结束响应时，fallback 一直等到宿主/底层取消，无法尝试下一 provider
- 多个 provider 原样返回远端 title/url/snippet；`max_results` 只限制条数，单字段与总输出可达数百 KiB/MB

## 2. 复现步骤

### 挂起 provider
1. 让 active provider 返回永不 settle 的 Promise 或服务端保持半开
2. 调用开启 autoFallback 的 `web_search`
3. 观察：后续 provider 永远不执行

### 无界结果
1. 让 SearXNG/第三方 provider 返回 10 条超长 snippet/title/url
2. 调用 `web_search`
3. 观察：完整远端字符串进入 `SearchOutcome.details`、模型文本和展开 TUI

复现频率：满足输入条件时稳定。

## 3. 期望 vs 实际

**期望行为**：每个 provider attempt 有 deadline；timeout 记入 attempted 后继续 fallback，外部取消立即终止。编排层统一限制结果字段和总 UTF-8 bytes，所有 provider 行为一致。

**实际行为**：串行 await 无 deadline；winner results 未规范化直接返回。

## 4. 环境信息

- 涉及模块：`packages/pi-web-search/src/search.ts`、`tools.ts`
- 相关 finding：当前 audit Finding 7 + 8
- 运行环境：Node 24，当前 HEAD `24477a2`

## 5. 严重程度

**P2** — 可用性、上下文与成本风险；有外部取消/切换 provider 的绕过方式，但应在包内建立边界。

## 备注

用户确认按建议合并处理 Finding 7 + 8；具体数值在 analysis checkpoint 拍板。

---
doc_type: issue-analysis
issue: 2026-07-11-web-search-budgets
status: confirmed
root_cause_type: missing-guard
related: [web-search-budgets-report.md]
tags: [web-search, timeout, output-budget, orchestration]
---

# web_search attempt / 输出预算根因分析

## 1. 问题定位

| 关键位置 | 说明 |
|---|---|
| `packages/pi-web-search/src/search.ts:62-86` | 串行 `await provider.search` 只透传外部 signal，无 attempt deadline |
| `packages/pi-web-search/src/search.ts:78-80` | 第一个非空 response 原样作为 winner 返回 |
| `packages/pi-web-search/src/tools.ts:99-107` | title/url/snippet 全量格式化，无总预算 |
| `packages/pi-web-search/src/tools.ts:111-126` | details 中同一原始 results 全量展开 |

## 2. 失败路径还原

**正常路径**：active provider 返回/抛错 → 空/错误时继续候选 → winner 结果进入文本与 details。

**失败路径 A**：provider Promise 不 settle → for-loop 卡在单次 await → fallback 永不推进。

**失败路径 B**：provider 返回少量但超长字段 → 条数合法 → 原字符串进入 outcome / content / TUI → 上下文和内存无统一边界。

**分叉点**：跨 provider 的可靠性与输出契约没有在 orchestrator 统一执行。

## 3. 根因

**根因类型**：missing-guard

**根因描述**：provider 接口只规定返回 shape，不规定时限或字段预算；编排层也未补齐。把边界分散到 provider 会让新增 provider 再次漏掉。

**是否有多个根因**：同一 orchestration contract 缺失的两个面：时间预算 + 输出预算。

## 4. 影响面

- **影响范围**：所有 search provider；autoFallback 的可用性；工具 content/details/TUI
- **潜在受害模块**：Exa MCP free（3 round trips）、自托管 SearXNG、所有 keyed provider
- **数据完整性风险**：无
- **严重程度复核**：维持 P2

## 5. 修复方案

### 方案 A：编排层固定预算（推荐）

- **Attempt**：每个 provider 最长 **15 秒**；用 timeout signal + Promise race，即使 provider 忽略 signal 也能继续 fallback；外部 signal 始终优先终止整个搜索
- **结果**：winner 返回前统一 UTF-8 规范化：title 512 B、URL 4096 B、snippet 2048 B；全部结果字段总计 **64 KiB**；`max_results` 仍为 1–10
- **错误**：attempted 单条错误文本限制 512 B
- **优点**：一个共享边界覆盖现有/未来 provider；改动集中、可单测；details 和模型文本同时受控
- **缺点 / 风险**：慢于 15 秒但最终可成功的 provider 会 fallback；极长字段被截断
- **影响面**：`search.ts` + tests + README/tool guideline

### 方案 B：各 provider 自行 timeout / truncate

- **优点**：可按 provider 调优
- **缺点 / 风险**：9 份重复逻辑；未来 provider 易漏；无法保证最终总预算
- **影响面**：所有 provider 文件与测试

### 方案 C：只在 formatSearchResults 最终截断

- **优点**：代码最少
- **缺点 / 风险**：details/TUI 仍持有无界结果；provider hang 完全未解决；截断可能切坏结构
- **影响面**：tools.ts，但不解决根因

### 推荐方案

**方案 A**：15 秒每 attempt + 64 KiB result-field 总预算 + 512/4096/2048 B 字段上限 + 512 B error 上限。固定值先解决边界；没有测量证据前不加配置 knobs。

## Checkpoint

用户确认方案 A 与数值：15 秒 attempt；64 KiB 总字段预算；512/4096/2048 B 字段 cap；512 B error cap。进入 tests-first 实现。

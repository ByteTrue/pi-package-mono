---
doc_type: issue-review
issue: 2026-07-11-web-search-budgets
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-11
round: 2
---

# web-search-budgets 代码审查报告

## 1. Scope And Inputs

- Report / analysis / fix-note：同目录，方案 A confirmed
- Diff：`search.ts`、`search-budget.test.ts`、`tools.ts`、README
- Baseline：clean，起点 commit `24477a2`

### Independent Review

- 环节 A：pi-subagents reviewer round 1 + final delta completed
- 环节 B：DeepSeek OCR `search.ts` / `tools.ts` completed
- Merge：外部 abort race 经复现后修复；OCR findings 逐条本地核验
- Gate effect：none

## 2. Diff Summary

- 15 秒 provider attempt deadline + ignored-signal Promise race
- external abort 优先并终止整条 fallback chain
- UTF-8 title/url/snippet per-field cap + 64 KiB aggregate
- attempted error 512 B
- 用户可见预算说明

## 3. Adversarial Pass

覆盖：provider 永不 settle、timeout signal 被忽略、external abort、resolve/abort 同 turn、timeout/abort 优先级、late promise、timer/listener cleanup、emoji 边界、64 KiB 精确 accounting、10 个结果、长 error。

Round 1 找到 external abort 与 provider success/timeout 竞争窗口；修复为 race 成功后复查，catch external 优先，候选间复查。Final delta 通过。

## 4. Findings

### blocking

none

### important

none（round 2）

### nit

- OCR 建议解释 UTF-8 bitmask 与修正 timeout 参数名，已处理。

### suggestion

- 可用 fake timers 扩展 deadline 前 1ms/late rejection；现有真实 5ms timeout 与 same-turn race 已覆盖核心语义。
- 可增加工具 execute 的 content/details 同源集成断言；当前代码明确复用 `outcome.results`。

### praise

- 预算集中在 orchestrator，覆盖未来 provider
- 即使 provider 忽略 signal，fallback 仍推进
- external cancellation reason 不被 timeout 覆盖
- UTF-8 截断保持完整 code point，总预算精确 64 KiB

### residual-risk

- 无整链总 deadline，最坏为候选数 × 15 秒
- 真正忽略 signal 的底层操作无法被 JS 强制回收
- field 预算不包含 query 与格式化分隔符

### OCR 事实核验

- `timer.unref()` 跨运行时 medium 不采纳：该 package 是 Node-only pi extension，使用 Node `fs/path/module` 与 npm undici；NodeJS Timeout API 是明确运行时契约。

## 5. Test And QA Focus

- search budget + existing search：11 passed
- pi-web-search：86 passed，9 skipped
- 全仓：130 passed，9 skipped
- 两个 workspace typecheck：通过
- `git diff --check`：通过

## 6. Verdict

**passed** — blocking 0、important 0、reviewer `subagent+ocr`。

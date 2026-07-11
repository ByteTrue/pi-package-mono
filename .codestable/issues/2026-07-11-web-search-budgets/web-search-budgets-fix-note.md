---
doc_type: issue-fix
issue: 2026-07-11-web-search-budgets
path: standard
status: review-passed
fix_date: 2026-07-11
related: [web-search-budgets-analysis.md, ../../audits/2026-07-11-pi-web-search-0-1-1/finding-07.md, ../../audits/2026-07-11-pi-web-search-0-1-1/finding-08.md]
tags: [web-search, timeout, output-budget, fallback]
---

# web_search attempt / 输出预算修复记录

## 1. 实际采用方案

采用用户确认的方案 A，统一在 `search.ts` 编排层建立时间与输出契约。

### Attempt deadline

- 默认每个 provider **15 秒**
- attempt 使用独立 AbortController，并把外部 abort 转发给 provider
- timeout 同时 abort provider signal，并用 Promise race 保证 provider 忽略 signal 时 fallback 仍继续
- 外部 signal abort 立即拒绝整个 search，不进入下一 provider
- timeout 记录为 `provider: timed out after 15000ms`

### Result budget

- title：512 UTF-8 bytes
- URL：4096 UTF-8 bytes
- snippet：2048 UTF-8 bytes
- 所有 winner result fields：64 KiB
- attempted error text：512 UTF-8 bytes
- UTF-8 截断回退到完整 code-point 边界，不产生 `�`
- max_results 保持 1–10

### 第一性原则 pre-pass

- 边界放在 orchestrator，覆盖现有/未来 provider
- 不在 9 个 provider 重复 timeout/truncate
- 不加配置 knobs；固定值先建立安全边界
- 不把最终文本硬切成无结构片段，content/details/TUI 共用同一 normalized results

## 2. 改动文件清单

- `packages/pi-web-search/src/search.ts`
  - provider attempt timeout/race
  - UTF-8 字段与总预算规范化
  - attempted error cap
- `packages/pi-web-search/src/search-budget.test.ts`
  - provider 忽略 signal 仍 timeout→fallback
  - 外部 abort 不 fallback；provider resolve 同 turn abort 仍以外部取消为准
  - Unicode 字段/64 KiB aggregate
  - attempted error 512 B
- `packages/pi-web-search/src/tools.ts`、`README.md`
  - 15 秒与 64 KiB 说明

## 3. 验证结果

- tests-first：4 项初始全失败；两个 timeout 测试分别挂满 Vitest 5 秒，证明旧实现无法推进/取消
- 修复后 search budget + 既有 search：11 passed
- pi-web-search：86 passed，9 skipped
- 全仓：130 passed，9 skipped
- 两个 workspace typecheck：通过
- `git diff --check`：通过

## 4. 遗留事项

- 没有总 fallback-chain deadline；最坏时间仍是候选数 × 15 秒，但不再无限挂起
- 真正忽略 signal 且永不 settle 的 provider Promise 不能被 JavaScript 强制终止；编排会继续，底层资源是否释放取决于 provider 是否遵守 signal
- result-field 预算不包含格式化分隔符/query 文本；远端 provider fields 已严格 ≤64 KiB
- 独立 subagent 最终：0 blocking / 0 important；DeepSeek OCR medium race 已修，Node-only `timer.unref()` 误报有运行环境事实反证；review gate passed。待 audit 回写与 commit，不 push。

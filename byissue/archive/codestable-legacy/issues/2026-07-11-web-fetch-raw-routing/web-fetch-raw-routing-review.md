---
doc_type: issue-review
issue: 2026-07-11-web-fetch-raw-routing
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-11
round: 1
---

# web-fetch-raw-routing 代码审查报告

## 1. Scope And Inputs

- Source: audit Finding 5
- Fix note: `web-fetch-raw-routing-fix-note.md`
- Diff：`tools.ts` 路由条件、routing test、generic 文档
- Baseline：clean，起点 commit `66e0757`

### Independent Review

- 环节 A：pi-subagents reviewer fresh，completed
- 环节 B：DeepSeek OCR，`tools.ts` 0 comments
- Gate effect：none

## 2. Diff Summary

- `raw=true`：generic-only
- `raw=false` / omitted：native-first
- native failure：generic fallback
- 不改 FetchDetails、search、provider implementations

## 3. Adversarial Pass

核验 raw true / false / omitted、native throw、signal/onUpdate 透传、真实 tool definition execute、mock 假绿、SSRF/proxy/redirect/10 MiB 组合能力与 provider API residual。

## 4. Findings

### blocking

none

### important

none

### nit

- generic 文档原先只写“provider 无 native 时”，已补 raw=true 场景。

### suggestion

- signal/onUpdate 可增加直接 routing 断言；当前实现和邻近测试已证明透传。

### praise

- 一行条件修复公开工具契约，不新增 capability registry
- routing tests 调用实际注册的 `execute`，旧实现会使 raw 用例失败，不是假绿
- omitted raw 显式锁定 native 先于 generic fallback

### residual-risk

- 包导出的 `FullProvider.fetch(url, raw)` 参数仍允许直接消费者传 true，而四个 native provider 忽略它；不影响 `web_fetch` 工具，本轮不做 semver/API 清理

## 5. Test And QA Focus

- routing + tools：7 passed
- pi-web-search：80 passed，9 skipped
- 全仓：124 passed，9 skipped
- 两个 workspace typecheck：通过
- `git diff --check`：通过

## 6. Verdict

**passed** — blocking 0、important 0、reviewer `subagent+ocr`。

---
doc_type: issue-review
issue: 2026-07-11-web-fetch-response-budget
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-11
round: 2
---

# web-fetch-response-budget 代码审查报告

## 1. Scope And Inputs

- Report: `web-fetch-response-budget-report.md`（confirmed）
- Analysis: `web-fetch-response-budget-analysis.md`（confirmed，方案 A / 10 MiB）
- Fix note: `web-fetch-response-budget-fix-note.md`
- Diff：shared reader、generic HTML、四个 native provider、tests、README/tools 文案
- Baseline dirty：none；本轮起点 commit `1966d55`

### Independent Review

- 环节 A：pi-subagents `reviewer` fresh，round 1 + round 2 completed
- 环节 B：OpenCodeReview，OpenAI-compatible `deepseek-v4-pro`；全源码 round 1 = 0 comments，最终 shared-reader delta round 2 completed
- Merge policy：所有外部 finding 经本地事实核验；Important 修复后复审
- Gate effect：none

## 2. Diff Summary

- 新增：`response-body.ts`、`response-body.test.ts`、`providers/body-budget.test.ts`
- 修改：`html.ts`、Tavily / Exa / Jina / Firecrawl、`tools.ts`、README
- 风险热点：ReadableStream 生命周期、压缩 Content-Length 语义、内存峰值、provider fallback

## 3. Adversarial Pass

攻击过的反例：

- 缺失 / NaN / 负数 / 偏小 / 超大 `Content-Length`
- gzip/br 传输长度与解压 stream 长度不同
- exact-limit / over-limit / max=0
- split UTF-8、tiny/empty chunks、大量 chunk 对象放大
- cancel / releaseLock / errored stream
- 成功 JSON、错误 body、四个 native provider 与 generic HTML 接线

Round 1 找到两个 Important：按 chunk 保存字符串对象可放大堆；压缩 response 不应以传输长度定义 decoded budget。均已修复。

## 4. Findings

### blocking

none

### important

none（round 2）

### nit

- `maxBytes=0/1` 与 `body.locked === false` 可增加显式测试；实现由边界判断与 `finally` 保证，不阻塞。

### suggestion

- 后续可扩展 provider search / !ok 无 header 的集成矩阵；共享 reader 与当前静态接线已覆盖根因。

### learning

- `Content-Length` 是传输层优化提示；非 identity 编码时不能代表解压后预算。
- 有界 bytes 不等于整个解析过程只占同等内存；buffer growth、decode、HTML/JSON 构造仍有常数倍峰值，但不再随网络无限增长。

### praise

- reader 使用单个有上限增长的连续 `Uint8Array`，不按 chunk 保留对象
- 越界前 cancel，所有路径 finally release lock
- 四个 native provider 的成功与错误 body 均接入；generic 路径同一预算
- 不新增依赖，预算内现有 truncate/temp spill 行为不变

### residual-risk

- JSON/HTML 解析有预算内常数倍分配
- native provider 超限按既有语义 fallback 到 generic，可能产生第二次网络请求
- search-only 的其他 provider 不在 Finding 3 范围；Finding 8 后续处理最终 search 输出预算

## 5. Test And QA Focus

- `@bytetrue/pi-web-search`：73 passed，9 skipped
- 全仓：117 passed，9 skipped
- 两个 workspace typecheck：通过
- `git diff --check`：通过
- 9 skipped 均为 live E2E

## 6. Verdict

**passed**

- blocking: 0
- important: 0
- reviewer: `subagent+ocr`
- 可回写 audit 并 scoped commit；不自动 push

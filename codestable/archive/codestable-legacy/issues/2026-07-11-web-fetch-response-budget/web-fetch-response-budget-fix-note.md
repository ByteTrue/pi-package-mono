---
doc_type: issue-fix
issue: 2026-07-11-web-fetch-response-budget
path: standard
status: review-passed
fix_date: 2026-07-11
related: [web-fetch-response-budget-analysis.md, ../../audits/2026-07-11-pi-web-search-0-1-1/finding-03.md]
tags: [performance, security, streaming, response-budget]
---

# web_fetch 响应预算修复记录

## 1. 实际采用方案

采用用户确认的方案 A：所有目标 response consumer 共用 **10 MiB 解压后 body 硬预算**。

- `Content-Length` 明确超限：读取前 cancel + 报错
- 无/错误/虚假 header：实际逐 chunk 累计 `Uint8Array.byteLength`
- 流中越界：立即 `reader.cancel()` + 报错
- UTF-8 先在有上限增长的连续 `Uint8Array` 中合并，再一次 decode；避免按 chunk 保留大量字符串对象
- JSON 先通过同一有界 text reader，再 `JSON.parse`
- 预算内保持原有 HTML 提取、模型上下文截断和 temp spill 行为

### 第一性原则 pre-pass

- 根因是 body consumer 无网络预算，不是输出 formatter
- 共享 reader 是唯一新增抽象，因为 generic + 4 provider 共 9 个实际消费点需要同一安全边界
- 未做无限落盘、增量 HTML/JSON parser、配置项或 temp 生命周期重构
- 不处理 Finding 8 的最终 search 文本总量；这里只限制 HTTP response body

## 2. 改动文件清单

- `packages/pi-web-search/src/response-body.ts`（新增）
  - `MAX_RESPONSE_BODY_BYTES = 10 MiB`
  - `readResponseText` / `readResponseJson`
- `packages/pi-web-search/src/response-body.test.ts`（新增）
  - split UTF-8、tiny/empty chunks、identity header 预拒绝、compressed header 跳过预拒绝、无 header 流中越界 cancel、恰好预算、JSON
- `packages/pi-web-search/src/html.ts`
  - generic HTML/raw/text 改用有界 reader
- `packages/pi-web-search/src/providers/{tavily,exa,jina,firecrawl}.ts`
  - search / native fetch 的成功与错误 body 全部改用有界 reader
- `packages/pi-web-search/src/providers/body-budget.test.ts`（新增）
  - 四个 native provider 分别验证超限 API response 被 cancel
- `packages/pi-web-search/src/tools.ts`、`README.md`
  - 明确 10 MiB decoded body 上限

## 3. 验证结果

- tests-first：新增 helper 测试在模块缺失时失败；最终 reader 测试 **7/7** 通过
- 定向：`response-body` + 4 providers + html/proxy = **48 passed**
- `@bytetrue/pi-web-search`：**73 passed，9 skipped**
- 全仓：**117 passed，9 skipped**
- `pi-vendor` / `pi-web-search` workspace typecheck：通过
- `git diff --check`：通过
- grep 核验：四个 native provider 和 generic html 不再直接 `await res.text()` / `res.json()`

## 4. 遗留事项

- 10 MiB 是固定安全预算；如未来有真实大页面需求，应以测量数据决定是否调整，而不是恢复无上限
- JSON 解析会在预算内额外构建对象，仍有常数倍内存，但已从无界变为上界明确
- Bing / Exa MCP free / SearXNG 等 search-only response 不在 Finding 3 的 web_fetch 修复范围；Finding 8 另行处理 search 输出预算
- 独立 subagent 最终：0 blocking / 0 important；DeepSeek OCR 最终：仅 2 条 low，可读性项已处理；review gate passed。待 audit 回写与 scoped commit，不 push。

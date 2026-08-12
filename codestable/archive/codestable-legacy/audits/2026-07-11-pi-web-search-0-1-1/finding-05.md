---
doc_type: audit-finding
audit: 2026-07-11-pi-web-search-0-1-1
finding_id: "bug-03"
nature: bug
severity: P2
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 05：raw=true 在四个 native-fetch provider 上无效

## 速答

工具 schema 承诺 `raw: true` 返回原始 HTML，但激活 Tavily / Exa / Jina / Firecrawl 时仍走 native extract/reader/scrape；四个实现都把参数命名为 `_raw` 并忽略。

## 关键证据

- `packages/pi-web-search/src/tools.ts:267-271` — 参数描述：“If true, return raw HTML”
- `packages/pi-web-search/src/tools.ts:283-301` — provider 有 `fetch` 就优先调用 `provider.fetch(url, raw, signal)`，不按 raw 改路由
- `packages/pi-web-search/src/providers/tavily.ts:50-64`、`exa.ts:48-60`、`jina.ts:40-51`、`firecrawl.ts:45-57` — 均为 `_raw`，返回 extract text / markdown，不可能是原 HTML
- `packages/pi-web-search/src/tools.test.ts` — 没有 web_fetch execute 或 raw provider 行为测试

## 影响

同一个公开工具参数随 active provider 改变语义；调用者请求源码做 DOM/脚本/元数据分析时会得到已处理文本，却没有告警。

## 修复方向

`raw: true` 时统一走 generic direct fetch，或在 provider capability 中显式声明 raw 支持并修正文档/返回 details。

## 建议动作

`cs-issue`，这是稳定可复现的公开工具契约偏差。

## 修复结果

`.codestable/issues/2026-07-11-web-fetch-raw-routing/` 将 `raw=true` 固定路由到 generic SSRF-safe fetch；raw false/omitted 保持 native-first，native failure 保持 generic fallback。真实 tool execute 路由矩阵覆盖。最终 review：`subagent+ocr` passed。

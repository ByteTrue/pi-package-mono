---
doc_type: audit-finding
audit: 2026-07-11-pi-web-search-0-1-1
finding_id: "performance-03"
nature: performance
severity: P2
confidence: high
suggested_action: cs-issue
status: open
---

# Finding 08：多个 provider 的 snippet 无长度上限，search 输出总量不受控

## 速答

`max_results` 只限制条数；SearXNG、Tavily、Brave、Jina、Firecrawl、Bocha 会原样保留远端 snippet，最终格式化也无总字节上限。

## 关键证据

- `packages/pi-web-search/src/providers/types.ts:13-17` — `SearchResult` 没有长度契约
- `packages/pi-web-search/src/providers/searxng.ts:50-55`、`tavily.ts:41-46`、`brave.ts:31-36`、`jina.ts:33-36`、`firecrawl.ts:36-41`、`bocha.ts:41-47` — 远端文本原样映射，无 cap
- `packages/pi-web-search/src/tools.ts:98-107` — 全量拼接 title/url/snippet；不像 web_fetch，没有 `truncateHead`
- `packages/pi-web-search/src/tools.ts:41-43` — 最大 10 条只限制数组长度，不限制每条或总量

## 影响

自托管/被污染 SearXNG 或异常第三方响应可让单次结果占用大量内存和模型上下文，增加延迟与费用。默认 Exa free 自身 cap 300 字符，但切换 provider 后不成立。

## 修复方向

在 orchestrator 统一规范化 provider 结果：限制 title/snippet/url 和总输出字节；provider 层限制作为补充，不能代替统一边界。

## 建议动作

`cs-issue`，应和 Finding 07 作为网络/输出预算一起实现与测试。

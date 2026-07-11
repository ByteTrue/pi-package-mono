---
doc_type: audit-finding
audit: 2026-07-11-pi-web-search-0-1-1
finding_id: "performance-02"
nature: performance
severity: P2
confidence: medium
suggested_action: cs-issue
status: open
---

# Finding 07：provider attempt 无 deadline，挂起请求阻断全部 fallback

## 速答

fallback 只处理返回空结果或抛错；任一 provider fetch 建连后长期不结束时，循环在底层/宿主超时或用户取消前都等不到下一候选。

## 关键证据

- `packages/pi-web-search/src/search.ts:62-86` — 串行 `await provider.search(...)`，没有单次 attempt timeout
- `packages/pi-web-search/src/providers/exa-free.ts:173-209` — 默认 provider 一次搜索有 3 个串行 HTTP round trip，都只使用外部 signal
- 全包搜索无 `AbortSignal.timeout` / deadline 组合逻辑
- `packages/pi-web-search/src/search.test.ts:31-59` — 只测 throw/空结果/关闭 fallback，没有 pending provider 场景

## 影响

默认 Exa MCP 或任一 active provider 出现半开连接/服务端不结束响应时，“自动 fallback”不会及时发生，web_search 会一直等待底层或宿主取消。置信度标 medium，因为运行时可能在更外层施加超时，但本包没有自己的 attempt 预算。

## 修复方向

为每个 provider attempt 组合外部 signal 与明确 deadline；超时记入 attempted 后继续 fallback，外部取消仍立即终止整个搜索。

## 建议动作

`cs-issue`，属于 fallback 可用性边界，不是纯结构重构。

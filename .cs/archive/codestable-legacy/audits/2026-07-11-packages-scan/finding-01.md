---
doc_type: audit-finding
audit: 2026-07-11-packages-scan
finding_id: "security-01"
nature: security
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 01：web_fetch SSRF 只校验初始 URL，redirect 与 provider fetch 可绕过

## 速答

`parseAndAssertHttpUrl` 只在入口拦私网 hostname，真正 `fetch` 开启 `redirect: "follow"` 且不复查最终 URL；走 Tavily/Jina 等 provider 原生 fetch 时甚至不再做本地 SSRF 校验。

## 关键证据

- `packages/pi-web-search/src/tools.ts:252` — `parseAndAssertHttpUrl(url)` 仅在 `web_fetch` 入口调用一次
- `packages/pi-web-search/src/html.ts:143-152` — `buildFetchRequestInit` / `fetchUrlOrThrow` 使用 `redirect: "follow"`，无最终 host 检查
- `packages/pi-web-search/src/tools.ts:265-274` — `"fetch" in provider` 时直接 `provider.fetch(url, ...)`，失败才回落 generic HTML
- `packages/pi-web-search/src/providers/jina.ts:40-47` — Jina 把用户 URL 拼到 `r.jina.ai/` 代取，本地不跑 SSRF
- `packages/pi-web-search/src/providers/tavily.ts:50-56` — Tavily extract 同样直接 POST 用户 URL

## 影响

- 公网可控的 302 可把 generic 路径导向 `169.254.169.254` / 内网服务（经典 open-redirect SSRF）
- 第三方 reader/extract 是否拦内网取决于对方服务策略，本工具无法保证
- 触发条件：agent 或用户传入恶意/被劫持 URL；本机有内网元数据或内服时影响更大

## 建议动作

`cs-issue`：对 generic 路径 manual redirect + 每跳 re-check；provider 路径至少文档声明“委托第三方”，或先 guard 再转发。

---
doc_type: issue-fix-note
issue: 2026-07-11-web-fetch-ssrf-redirect
status: fixed
severity: P1
source: .codestable/audits/2026-07-11-packages-scan/finding-01.md
---

# web-fetch-ssrf-redirect 修复记录

## 根因

`fetchUrlOrThrow` 使用 `redirect: "follow"`，只在入口 `parseAndAssertHttpUrl` 校验初始 URL，跟随 302 时不再检查 Location，可跳到私网。

## 改动

- `packages/pi-web-search/src/html.ts`：`redirect: "manual"`，循环跟随 Location，每跳 `parseAndAssertHttpUrl`，上限 5 跳
- `packages/pi-web-search/src/html.test.ts`：公开 redirect 成功 + 跳私网/loopback 拒绝

## 验证

`npm --workspace @bytetrue/pi-web-search test` — 38 passed（含 html 16）

## 遗留

- 第三方 provider（Tavily/Jina/Exa/Firecrawl）原生 fetch 仍委托对方；本地 generic 路径已加固
- DNS rebinding / 解析后 IP 校验未做

## 路径

快速通道（audit finding 根因已明确）

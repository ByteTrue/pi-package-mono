---
kind: issue
title: "快改：固定 web search provider 配置"
type: ff
status: closed
created: 2026-08-24
---

# 快改：固定 web search provider 配置

## 做了什么

移除模型可见的 `web_search.provider` 参数，让搜索 provider 始终由 `/web` 当前 active 配置决定；保留 `max_results`，默认 5，允许模型按任务需要调整。

## 改了哪些

- `packages/pi-web-search/src/tools.ts`：删除 `provider` schema，并固定调用路由的 provider override 为 `undefined`。
- `packages/pi-web-search/src/tools.test.ts`：更新 schema 与路由断言，覆盖结果数量可选控制和 active provider 使用。

## 怎么验证

- `npm test --workspace @bytetrue/pi-web-search`：103 passed，9 live E2E skipped。
- `npm run typecheck --workspace @bytetrue/pi-web-search`：通过。
- `git diff --check`：通过。

## 对 `.cs/` 的影响

无影响。此次实现收紧了模型工具边界，不改变 `/web` provider 配置和底层 provider 路由契约。

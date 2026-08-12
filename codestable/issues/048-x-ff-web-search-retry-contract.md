---
kind: issue
title: "快改：让 web_search 首轮服从 /web provider"
type: ff
status: closed
created: 2026-08-06
---

# 快改：让 web_search 首轮服从 /web provider

## 问题

`web_search` 原参数名为 `provider`。虽然 description 写了省略时使用 `/web` 当前 provider、显式值用于 retry，但中性参数名和完整 provider 列表仍可能诱导模型在首轮自行选择，从而绕过用户在 TUI 中做出的配置。

一次 smoke 也显式传了 `max_results: 2`，容易被误解为正式默认只返回两条；实际默认一直是 5。

## 根因

工具 schema 没有把两个可选参数的使用时机编码进接口语言：

- `provider` 没有表达“只用于失败后的重试”；
- `max_results` 只写 default 5，没有明确正常应省略、不要无故降低。

## 修改

- 将 `provider` 重命名为 `retry_provider`。
- tool description 与参数 description 明确：
  - 首轮必须省略 `retry_provider`，使用 `/web` 当前 provider；
  - 只有前一次 `web_search` 失败后才设置；
  - 正常省略 `max_results`，默认请求 5 条；除非用户要求更少，否则不要降低。
- provider 失败信息改为直接提示下一调用使用 `retry_provider`。
- README、Project Spec 与已关闭 Epic 的接口记录同步更新。

未增加 session 状态机：工具契约负责模型行为，package 仍保持一次调用只联系一个 provider。

## 验证

- `npm test --workspace @bytetrue/pi-web-search`：103 passed，9 live E2E skipped。
- 注册工具执行测试证明：省略 optional fields 传 active config + default 5；显式 `retry_provider` 才覆盖 provider；live E2E 也改为首轮只传 `{query}`。
- `npm run typecheck --workspace @bytetrue/pi-web-search`：通过。
- `git diff --check`：通过。
- 新 Pi 进程真实 Tavily smoke，仅传 `{query}`：
  - schema 不再暴露 `provider`；
  - 暴露 optional `retry_provider`；
  - `max_results.default === 5`；
  - backend 为 `/web` 配置的 `tavily`；
  - 返回 5 条结果。

## 关闭结论

正常首次搜索现在在 schema、提示词和运行验证三层都以 `/web` 配置为权威；只有失败后的显式重试才应覆盖 provider。两条结果仅来自先前 smoke 的人为上限，不是产品默认。

## 后续修正

该接口约束随后被 `codestable/issues/049-x-ff-simplify-web-search-schema.md` 取代：`retry_provider` 属于为限制模型行为而引入的非惯用 API，最终恢复为中性的 optional `provider` / `max_results`。本 issue 仅保留为决策历史。

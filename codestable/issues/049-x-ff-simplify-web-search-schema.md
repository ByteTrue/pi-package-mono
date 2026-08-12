---
kind: issue
title: "快改：简化 web_search schema"
type: ff
status: closed
created: 2026-08-06
---

# 快改：简化 web_search schema

## 问题

上一轮为防止模型在 smoke 中覆盖 `/web` 配置，把 `provider` 改成了 `retry_provider`，并在 description 中加入“首轮必须省略”“不要降低结果数量”等行为限制。

这把一次测试误用过度固化进产品接口：`retry_provider` 不符合常见工具 API，冗长提示也削弱了模型根据任务自行选择 provider 与结果数量的空间。

## 修改

`web_search` 恢复最小 schema：

- `query`：required；
- `max_results`：optional，1–10，default 5；
- `provider`：optional；省略时使用 `/web` active provider。

删除：

- `retry_provider`；
- `MUST`、首轮/失败后限制；
- “不要降低结果数量”等模型行为管教；
- 失败信息中的 retry 指令。

保留事实契约：一次调用只联系一个 provider，不做隐式 fallback；失败时仅列出其它当前可调用的 provider。

`codestable/issues/048-x-ff-web-search-retry-contract.md` 被本 issue 取代，仅作为决策历史保留。

## 验证

- `npm test --workspace @bytetrue/pi-web-search`：103 passed，9 live E2E skipped。
- `npm run typecheck --workspace @bytetrue/pi-web-search`：通过。
- `git diff --check`：通过。
- 新 Pi 进程真实 Tavily smoke：schema 只有 `query`、`max_results`、`provider`；仅传 query 时使用 configured Tavily 并返回默认 5 条。

## 关闭结论

工具只陈述参数和事实边界，不通过特殊参数命名或命令式提示约束模型策略。Less is more。

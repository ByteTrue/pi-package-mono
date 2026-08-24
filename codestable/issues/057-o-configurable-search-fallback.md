---
kind: issue
title: "可配置 web search provider fallback 链"
type: feature
status: open
created: 2026-08-24
---

# 可配置 web search provider fallback 链

## 目标

让 web search 在用户配置的 provider 链上按顺序尝试；模型继续只控制查询和 `max_results`，不参与 provider 选择。通过 `/web` 菜单配置链顺序。

## 已确认边界

- 新配置使用 `providers` 数组：第一项是 active provider，后续项是 fallback。
- 兼容读取旧的单项 `provider` 配置；新写入优先使用 `providers`。
- 用户取消搜索时不 fallback。
- provider 失败或超时后继续下一个；返回成功 provider 和尝试信息。
- `/web` 菜单允许选择 active provider、配置 fallback 顺序、配置 proxy。
- `max_results` 保持模型可控，默认 5，范围 1-10。

## 质量目标

- 功能正确性：按配置顺序尝试 provider，成功即停止；配置缺失时保持默认 provider 行为。
- 可靠性/容错性：单个 provider 失败或超时不阻断链上后续 provider；外部取消立即终止整个搜索。
- 兼容性：现有只含 `provider` 的配置继续有效；不把旧的 `autoFallback` 行为重新激活。
- 交互能力：`/web` 中能看见当前顺序，并能以可恢复的方式逐步配置 fallback。
- 可维护性/可测试性：链解析、尝试和菜单保存边界通过行为测试覆盖。

## 执行记录

- `config.ts` 增加 `providers` 数组解析；旧 `provider` 读取兼容，新写入统一规范化为 `providers`。
- `search.ts` 按链顺序尝试 provider；创建失败、请求失败或单次超时会继续，外部取消立即终止。
- `web_search` 仍不暴露 provider 参数，结果 details 增加 `attemptedProviders`。
- `/web` 增加 provider fallback chain 菜单，按用户选择顺序保存。

## 验证

- `npm run typecheck --workspace @bytetrue/pi-web-search` 通过。
- `npm test --workspace @bytetrue/pi-web-search -- --run` 通过：12 个测试文件通过，110 个测试通过；9 个 live E2E 按预期跳过。
- `git diff --check` 通过。

## 关闭回写

待用户验收后补充。

## 风险与穿刺

- fallback 链按每个 provider 独立超时，多个 provider 可能累加等待时间；当前保留既有单次 15 秒超时，没有新增整链总 deadline。
- 菜单只允许选择已配置或免 key 的 provider；需要 base URL 的 provider（如未配置 URL 的 SearXNG）不会进入候选。
- 空结果不触发 fallback；只有 provider 创建失败、请求失败或超时才继续。

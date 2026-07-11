---
doc_type: audit-index
audit: 2026-07-11-pi-web-search-0-1-1
scope: packages/pi-web-search 0.1.1 当前 origin/main（HEAD 0b2e19d）
created: 2026-07-11
status: active
total_findings: 9
dimensions: [bug, security, performance, maintainability]
arch_drift: skipped-no-adrs
supersedes: 2026-07-11-packages-scan（仅 pi-web-search 部分）
---

# pi-web-search 0.1.1 当前树审计报告

## 范围

- 当前 `origin/main` / HEAD `0b2e19d`，工作树与远端一致
- `packages/pi-web-search/src/**/*.ts`；测试用于核验证据
- 版本：`@bytetrue/pi-web-search@0.1.1`
- 维度：bug / security / performance / maintainability
- 跳过 arch-drift：`.codestable/requirements/adrs/` 不存在，无 ADR 对照源
- 旧审计 `2026-07-11-packages-scan` 基于 stale tree；其 **pi-web-search 部分**由本报告取代，pi-vendor 部分仍保留

## 总评

当前树比旧树明显更完整：默认 provider 已是 `exa-free`，redirect 采用 manual + 每跳检查，配置写入已原子化且 `0600`，fallback 与基础测试均可运行。新 provider / proxy 路径也带来了新的边界风险。

共发现 **9** 条：security 1、bug 4、performance 3、maintainability 1；P0 0、P1 4、P2 5。最优先的是：SSRF host guard 仍可被 `localhost.` / IPv4-mapped IPv6 / DNS 私网解析绕过；显式 proxy 与 `ALL_PROXY` 的实际行为不符合代码和文档；`web_fetch` 在截断前完整缓冲不可信响应；坏配置会被 `/web` 静默覆盖。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | security | P1 | high | SSRF guard 可被尾点 localhost、IPv4-mapped IPv6 和 DNS 私网解析绕过 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | high | 显式 proxy 可能被小写 env 覆盖，ALL_PROXY 被报告已安装但实际未使用 | [finding-02.md](finding-02.md) |
| 3 | performance | P1 | high | web_fetch 在截断前完整缓冲响应，可被大响应拖垮进程 | [finding-03.md](finding-03.md) |
| 4 | bug | P1 | high | 无效 config 被读成空对象后，/web 会静默覆盖原文件 | [finding-04.md](finding-04.md) |
| 5 | bug | P2 | high | raw=true 在四个 native-fetch provider 上无效 | [finding-05.md](finding-05.md) |
| 6 | bug | P2 | high | 越界数字 HTML entity 会让整页提取抛 RangeError | [finding-06.md](finding-06.md) |
| 7 | performance | P2 | medium | provider attempt 无 deadline，挂起请求阻断全部 fallback | [finding-07.md](finding-07.md) |
| 8 | performance | P2 | high | 多个 provider 的 snippet 无长度上限，search 输出总量不受控 | [finding-08.md](finding-08.md) |
| 9 | maintainability | P2 | high | proxy 通过全局 dispatcher 改写整个 Pi 进程且无完整恢复/释放模型 | [finding-09.md](finding-09.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 2 | 2 | 4 |
| security | 0 | 1 | 0 | 1 |
| performance | 0 | 1 | 2 | 3 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | — | — | — | 跳过 |
| **合计** | **0** | **4** | **5** | **9** |

## 已核验为有效的现有防护

- redirect SSRF：`redirect: "manual"`，每跳重跑 URL 字面检查；旧 Finding 1 的 redirect 缺口已修
- config：同目录 temp + rename，目标 inode 为 `0600`
- 默认 provider：`exa-free`；DDG 已删
- SearXNG：无显式 URL 时不会进入普通 fallback 候选
- 自动化：当前 `pi-web-search` **77 passed**、`9 skipped`；全仓 **121 passed**、`9 skipped`；两个 workspace typecheck 通过；最终 code review `subagent+ocr` passed

## 下一步建议

- **P1 已清零**：Finding 1–4 全部 fixed；下一步从 P2 Finding 5 开始
- **P2 下一批**：Finding 5 + 6 可做小修；Finding 7 + 8 一起做网络/输出预算；Finding 9 随 proxy 修复一起收口生命周期
- 本 audit 只发现、不修代码；选中 finding 后在当前 run 路由到 `cs-issue` / `cs-refactor`

## 修复进度

| Finding | 状态 | 记录 |
|---|---|---|
| 1 SSRF host / DNS / rebind | fixed | `.codestable/issues/2026-07-11-web-fetch-ssrf-host-resolution/` |
| 2 proxy precedence / ALL_PROXY | fixed（随 Finding 1 transport review-fix） | 同上 |
| 3 web_fetch response budget | fixed | `.codestable/issues/2026-07-11-web-fetch-response-budget/` |
| 4 invalid config overwrite | fixed | `.codestable/issues/2026-07-11-web-config-invalid-preserve/` |
| 5–9 | open | 按上方顺序后续处理 |

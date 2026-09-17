---
doc_type: issue-report
issue: 2026-07-11-web-fetch-response-budget
status: confirmed
severity: P1
summary: web_fetch 在输出截断前完整缓冲无上限响应，可能耗尽进程内存
tags: [performance, security, web-fetch, streaming]
---

# web_fetch 响应无下载预算 Issue Report

## 1. 问题现象

`web_fetch` 面对超大、无限或解压后巨大的响应时，会在产生任何截断结果前持续增加 Pi 进程内存，可能长时间卡住或 OOM。界面宣称的“截断并保存到临时文件”只限制最终模型输出，不限制网络读取与内存。

## 2. 复现步骤

1. 启动一个公开 HTTP endpoint，持续返回文本 chunk，不提供可信 `Content-Length`（或返回解压后巨大的 body）
2. 调用 `web_fetch` 获取该 URL
3. 观察到：generic 路径先执行完整 `Response.text()`；native provider 路径先执行完整 `text()` / `json()`；达到上下文截断逻辑前内存持续增长

复现频率：稳定。

## 3. 期望 vs 实际

**期望行为**：每个 HTTP response body 有明确硬预算；超过预算立即 cancel 网络流并给出可理解错误。预算内的页面继续按现有逻辑提取、截断并把完整提取文本保存到 temp。

**实际行为**：body 无硬预算；`truncateHead` 只在完整字符串已驻留内存后执行。

## 4. 环境信息

- 涉及模块 / 功能：`packages/pi-web-search` 的 generic `web_fetch` 与 Tavily / Exa / Jina / Firecrawl native fetch
- 相关文件 / 函数：`html.ts:extractBodyAsText`、`tools.ts:web_fetch.execute`、四个 provider 的 `fetch/search`
- 运行环境：Node 24 / undici 8.5.0，当前 `main` HEAD `1966d55`
- 其他上下文：审计 `.codestable/audits/2026-07-11-pi-web-search-0-1-1/finding-03.md`

## 5. 严重程度

**P1** — 不可信公开 URL 可稳定制造无界内存增长；上下文截断不能缓解下载阶段的资源耗尽。

## 备注

用户在审计顺序中回复“继续”，确认处理 Finding 3。响应预算的具体方案由 analysis checkpoint 决定。

---
doc_type: issue-fix
issue: 2026-07-11-web-fetch-raw-routing
path: fast-track
status: review-passed
fix_date: 2026-07-11
related: [../../audits/2026-07-11-pi-web-search-0-1-1/finding-05.md]
tags: [web-fetch, raw-html, provider-routing]
---

# web_fetch raw 路由修复记录

## 1. 问题描述

`web_fetch` schema 承诺 `raw=true` 返回原始 HTML，但 active provider 为 Tavily / Exa / Jina / Firecrawl 时仍优先调用 native extract/reader/scrape。这些 endpoint 忽略 raw 参数并返回文本/Markdown。

用户按 audit 顺序回复“继续”，确认快速通道修复。

## 2. 根因

`packages/pi-web-search/src/tools.ts` 仅按 provider 是否有 `fetch` method 路由，没有把 `raw` 作为 capability 条件；工具层契约与 provider endpoint 能力不一致。

## 3. 修复方案

- `raw=true`：强制走 `fetchViaGenericHtml(url, true, signal)`，复用现有 SSRF、proxy、redirect、10 MiB response budget
- `raw=false` / 未传：保留 native-first
- native 抛错：保留 generic fallback，参数为 false
- 不修改 provider API、不增加 capability registry；当前唯一 raw-capable transport 就是 generic

### 第一性原则 pre-pass

一行路由条件即可修复工具契约；不为四个相同能力的 provider 新增抽象或配置。

## 4. 改动文件清单

- `packages/pi-web-search/src/tools.ts`：native 分支增加 `!raw`
- `packages/pi-web-search/src/web-fetch-routing.test.ts`：真实 tool execute 的 raw / non-raw / fallback 路由矩阵与 omitted-raw native→generic 调用顺序
- `packages/pi-web-search/src/html.ts`、`README.md`：generic 使用场景说明对齐 raw 路由

## 5. 验证结果

- tests-first：3 项中 raw=true 初始失败，另外两项证明旧 non-raw/fallback 行为基线
- 修复后 routing + tools：7 passed
- pi-web-search：80 passed，9 skipped
- 全仓：124 passed，9 skipped
- 两个 workspace typecheck：通过
- `git diff --check`：通过

## 6. 遗留事项

- `FullProvider.fetch(raw)` 的四个 provider 实现仍忽略 raw；这是内部/provider API 形状，公开 `web_fetch` 已不向其传 true。若未来要求直接调用 provider API 也支持 raw，应另行调整 contract
- 独立 subagent：0 blocking / 0 important；DeepSeek OCR：0 comments；review gate passed。待 audit 回写与 commit，不 push。

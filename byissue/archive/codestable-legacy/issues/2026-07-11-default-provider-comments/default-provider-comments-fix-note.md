---
doc_type: issue-fix-note
issue: 2026-07-11-default-provider-comments
status: fixed
severity: P2
source: .codestable/audits/2026-07-11-packages-scan/finding-04.md
---

# default-provider-comments 修复记录

## 根因

`DEFAULT_PROVIDER_NAME = "bing"`，模块注释仍写 DuckDuckGo 为 default。

## 改动

- `src/index.ts`、`src/tools.ts`、`src/providers/duckduckgo.ts` 注释对齐 Bing 默认

## 验证

测试全绿；纯文案。

## 合并

覆盖 audit finding-04 + finding-06。

## Rebase note

Upstream `main` (pi-web-search 0.1.1) removed DuckDuckGo and set `DEFAULT_PROVIDER_NAME = "exa-free"`.
Our comment patch that said "default Bing" was dropped during rebase in favor of upstream Exa free comments.
Runtime default is now Exa free, not Bing.

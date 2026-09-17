---
doc_type: issue-fix
issue: 2026-07-11-html-entity-codepoint
path: fast-track
status: review-passed
fix_date: 2026-07-11
related: [../../audits/2026-07-11-pi-web-search-0-1-1/finding-06.md]
tags: [html, entity, web-fetch, parser]
---

# 无效数字 HTML entity 修复记录

## 1. 问题描述

HTML 中的越界数字 entity 会直接传给 `String.fromCodePoint` 并抛 `RangeError`，使整个 `web_fetch` 页面提取失败。

用户按 audit 顺序回复“继续”，确认快速通道修复。

## 2. 根因

`packages/pi-web-search/src/html.ts` 的十进制/十六进制 entity replacement 没有先验证 Unicode scalar value。

## 3. 修复方案

新增单一 numeric entity decoder：

- 合法 Unicode scalar value → `String.fromCodePoint`
- `0`、非整数/溢出、`>0x10FFFF`、UTF-16 surrogate `0xD800–0xDFFF` → `�`
- named entities 与合法 numeric entity 行为不变

### 第一性原则 pre-pass

只在异常抛出点加 scalar-value guard；不引入 HTML parser 依赖或扩展为完整 HTML entity spec 实现。

## 4. 改动文件清单

- `packages/pi-web-search/src/html.ts`：`decodeNumericEntity`
- `packages/pi-web-search/src/html.test.ts`：decimal/hex 的 zero、surrogate、上界外、合法 0x10FFFF 与 parseInt→Infinity 巨大值

## 5. 验证结果

- tests-first：新增测试初始稳定复现 `RangeError: Invalid code point 1114112`（`0x110000`）
- 修复后 html：32 passed
- pi-web-search：81 passed，9 skipped
- 全仓：125 passed，9 skipped
- 两个 workspace typecheck：通过
- `git diff --check`：通过

## 6. 遗留事项

- 本修复只覆盖会抛错或不是 Unicode scalar value 的数字引用；不尝试实现 HTML 标准对 C1 controls / noncharacters 的完整 parse-error remap
- 独立 subagent：0 blocking / 0 important；DeepSeek OCR：0 comments；review gate passed。待 audit 回写与 commit，不 push。

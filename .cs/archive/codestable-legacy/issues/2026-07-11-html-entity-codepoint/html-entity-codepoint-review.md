---
doc_type: issue-review
issue: 2026-07-11-html-entity-codepoint
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-11
round: 1
---

# html-entity-codepoint 代码审查报告

## 1. Scope And Inputs

- Source: audit Finding 6
- Fix note: `html-entity-codepoint-fix-note.md`
- Diff：`html.ts` decoder + `html.test.ts`
- Baseline：clean，起点 commit `c7c4f72`

### Independent Review

- 环节 A：pi-subagents reviewer fresh，completed
- 环节 B：DeepSeek OCR `html.ts`，0 comments
- Gate effect：none

## 2. Diff Summary

- numeric entity 共用 scalar decoder
- zero / surrogate / out-of-range / Infinity → U+FFFD
- legal scalar → `String.fromCodePoint`

## 3. Adversarial Pass

覆盖 decimal/hex、0、surrogate、0x10FFFF、0x110000、极长数字→Infinity、named/valid entity 回归、regex 不匹配的负数/空值。

## 4. Findings

### blocking

none

### important

none

### nit

- fix-note 初始误写 surrogate 抛 RangeError；已改为实际抛错的 `0x110000`。

### suggestion

- 完整 HTML 标准的 C1 control remap/noncharacter parse errors 可另行实现；不属于本 bug。

### praise

- guard 集中且最小，不引入 parser 依赖
- 上界使用 `>`，合法 0x10FFFF 不误拒
- 巨大 parseInt→Infinity 被 `Number.isInteger` 拦截

### residual-risk

- 大写 `X`、无分号、C1 remap 未实现，与既有有限 entity decoder 行为一致

## 5. Test And QA Focus

- html：32 passed
- pi-web-search：81 passed，9 skipped
- 全仓：125 passed，9 skipped
- 两个 workspace typecheck：通过
- `git diff --check`：通过

## 6. Verdict

**passed** — blocking 0、important 0、reviewer `subagent+ocr`。

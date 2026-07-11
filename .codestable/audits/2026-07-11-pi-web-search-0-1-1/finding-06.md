---
doc_type: audit-finding
audit: 2026-07-11-pi-web-search-0-1-1
finding_id: "bug-04"
nature: bug
severity: P2
confidence: high
suggested_action: cs-issue
status: open
---

# Finding 06：越界数字 HTML entity 会让整页提取抛 RangeError

## 速答

`htmlToText` 把任意十进制/十六进制 entity 直接交给 `String.fromCodePoint`；值大于 `0x10ffff` 时抛 `RangeError`，导致整个 `web_fetch` 失败。

## 关键证据

- `packages/pi-web-search/src/html.ts:40-41` — regex 接受任意长度数字
- `packages/pi-web-search/src/html.ts:53-66` — 无范围校验直接调用 `String.fromCodePoint(Number(...))`
- 本机 Node 24 复现：`String.fromCodePoint(99999999)` → `RangeError: Invalid code point 99999999`
- `packages/pi-web-search/src/html.test.ts:11-14` — 只覆盖合法 entity，没有畸形/越界值

## 影响

任意公开 HTML 页面只需包含 `&#99999999;` 即可让提取失败；这是无害坏标记引发的整页不可用，不需要控制响应头或网络时序。

## 修复方向

解析后校验 `0 <= codePoint <= 0x10ffff` 且排除不合法值；失败时保留原 entity 或替换为 `�`。

## 建议动作

`cs-issue`，一处 guard + 一条回归测试即可封口。

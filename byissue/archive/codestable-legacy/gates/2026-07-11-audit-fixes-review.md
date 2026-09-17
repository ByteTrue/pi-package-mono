---
doc_type: code-review
slug: 2026-07-11-audit-fixes
status: passed
reviewer: self
source: audit findings 1-4+6 fixes
---

# 审计修复 diff 审查

## 范围

`packages/pi-web-search`（html/config/index/tools/duckduckgo + html.test）  
`packages/pi-vendor`（models-json + test）  
`.codestable/issues/*` fix-notes + audit 状态

## 对照目标

| 目标 | 是否达成 |
|---|---|
| SSRF redirect re-check | 是：manual + 每跳 parseAndAssertHttpUrl |
| config key 文件权限 | 部分：0o600；仍允许明文 key |
| 原子写 | 是：tmp + rename |
| 默认 provider 注释 | 是：Bing |

## 正确性

- redirect 循环上限 5、无 Location 抛错、相对 Location 用 base URL 解析 — OK
- 起始 URL 在 `fetchUrlOrThrow` 内再 guard — 防漏调 parseAndAssertHttpUrl — OK
- 原子写同目录 rename — POSIX 下原子替换 — OK
- mode 0o600 写在 tmp 上，rename 后保留 — OK

## 安全

- Critical：无
- Important：无阻塞项
- 已知遗留（fix-note 已记）：第三方 provider fetch 不本地 SSRF；DNS rebinding 未做；明文 key 仍可落盘

## 可维护性

- 改动面小，无新抽象
- 测试覆盖 redirect 成功/跳私网

## 结论

**passed** — 可提交。不阻塞项不要求改。

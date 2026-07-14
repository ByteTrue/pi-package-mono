---
doc_type: issue-review
issue: 2026-07-11-web-config-invalid-preserve
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-11
round: 3
---

# web-config-invalid-preserve 代码审查报告

## 1. Scope And Inputs

- Source: audit Finding 4
- Fix note: `web-config-invalid-preserve-fix-note.md`
- Diff：`config.ts`、`tools.ts`、`config-file.test.ts`
- Baseline：clean，起点 commit `960ae95`

### Independent Review

- 环节 A：pi-subagents reviewer，三轮 completed
- 环节 B：DeepSeek OCR 审 `config.ts` / `tools.ts`，0 comments
- Merge：round 1 blocker 与 round 2 测试缺口均修复并复审
- Gate effect：none

## 2. Diff Summary

- 配置读取新增 missing / valid / invalid 三态
- 运行时 `readConfig()` 保持 fail-soft
- `/web` invalid 时在 show/select/input/write 前返回
- 测试真实 handler 与磁盘原 bytes

## 3. Adversarial Pass

覆盖：ENOENT、JSON malformed、schema invalid、`--show` 前置顺序、路径提示、配置内容/API key 泄漏、原文件保全、动态模块路径隔离。

Round 1 抓到原始 `JSON.parse` message 可泄漏 token；改为固定 `invalid JSON`。Round 2 发现长 token 可能只泄漏前缀导致测试假阴性；改用 `LEAKME` 并先断言原生 parser message 确实包含它。

## 4. Findings

### blocking

none

### important

none（round 3）

### nit

- 文件系统错误通常会在自定义路径前缀后重复路径；不影响保全或凭证安全。

### suggestion

- 后续可扩充 EISDIR/EACCES、schema-invalid handler、missing→create 的交互矩阵；当前根因路径已被真实 handler 测试覆盖。

### praise

- 仅 ENOENT 视为 missing；其他读取错误 fail closed
- unknown schema fields 仍通过 `additionalProperties: true` 保留前向兼容
- 解析错误不再传播原始 JSON 片段
- 写盘前 guard 顺序正确，原文件 byte-for-byte 不变

### residual-risk

- 交互期间另一进程修改文件的 TOCTOU 仍属独立并发控制问题
- dangling symlink 的 ENOENT 语义未单独区分

## 5. Test And QA Focus

- pi-web-search：77 passed，9 skipped
- 全仓：121 passed，9 skipped
- 两个 workspace typecheck：通过
- `git diff --check`：通过

## 6. Verdict

**passed** — blocking 0、important 0、reviewer `subagent+ocr`。

---
kind: issue
title: "web_fetch 10MiB body 预算"
type: bug
status: closed
created: 2026-07-11
epic: ""
---

# web_fetch 10MiB body 预算

## 目标

修复后：共享 bounded reader，超限 cancel

## 归属

- 独立 issue
- 相关 spec：`.cs/spec/pi-web-search/index.md`（atomic 亦涉及 vendor）

## 当前证据

- 预期行为：安全/正确的配置与网络边界
- 实际行为（修复前）：response consumer 无硬预算
- 原始证据：`.cs/archive/codestable-legacy/issues/2026-07-11-web-fetch-response-budget/` 与对应 audits

## 反馈回路

- 命令：`npm --workspace @bytetrue/pi-web-search test` 与/或 vendor test
- 最近一次结果：关闭时通过

## 复现与最小化

见 archive fix-note / analysis。

## 根因定位

- 根因摘要：response consumer 无硬预算

## 修复方案

共享 bounded reader，超限 cancel

## 验证

- response-body 测试

## 执行记录

- 从旧 CodeStable issue 迁移为 closed bug；代码已在 main

## 顺手发现

- 无新开

## 关闭回写

- project spec：web-search / vendor 安全与配置约定
- notes：atomic-config-0o600、web-search-package-proxy（相关项）

## 关闭结论

- 根因摘要：response consumer 无硬预算
- 修复摘要：共享 bounded reader，超限 cancel
- 验证摘要：response-body 测试
- 遗留事项：不含 search 文本总量（另 budgets issue）

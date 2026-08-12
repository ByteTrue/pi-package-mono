---
kind: issue
title: "配置 BySpace worktree 准备"
type: ff
status: closed
created: 2026-08-01
epic: ""
---

# 配置 BySpace worktree 准备

## 做了什么

让 BySpace 创建 worktree 后异步执行 `npm ci`，按 lockfile 自动准备 workspace dependencies。

## 改了哪些

- `byspace.json` — 增加 `worktree.setup: "npm ci"`。
- `codestable/notes/005-pi-local-package-loading.md` — 记录 setup 时序与本地 package 单来源边界。
- `codestable/spec/index.md` — 记录 worktree 的开发环境准备方式。

## 怎么验证的

配置通过 BySpace 0.2.1 schema/loader 解析；`npm ci` 已在实际 BySpace worktree `snappy-blowfish` 成功安装 201 packages；全 workspace 检查通过。

## 对 codestable/ 的影响

- 已同步 project spec：`codestable/spec/index.md`。
- 已同步 note：`codestable/notes/005-pi-local-package-loading.md`。

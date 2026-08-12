---
kind: issue
title: "Worktree 中 extension 缺依赖与重复加载"
type: ff
status: closed
created: 2026-08-01
epic: ""
---

# Worktree 中 extension 缺依赖与重复加载

## 做了什么

停止从 repo 的 `.pi/settings.json` 自动加载 worktree 内的 TS extension，避免新 worktree 尚无 dependencies 时启动失败，也避免它与用户级同名 package 重复注册 tools。

## 改了哪些

- `.pi/settings.json` — 删除 workspace package 自动加载。
- `.gitignore` — 恢复忽略本地 `.pi/settings.json`。
- `codestable/notes/005-pi-local-package-loading.md` — 记录绝对路径 identity 与单来源规则。
- `codestable/spec/index.md` — 记录 worktree extension 隔离边界。

## 怎么验证的

在原 `snappy-blowfish` worktree 安装 dependencies 后分别验证：重复来源会稳定触发五个 `pty_*` 冲突；只保留用户级来源或隔离加载当前 checkout 时，Pi RPC 均成功且 extension errors 为 0。全 workspace 检查通过。

## 对 codestable/ 的影响

- 已同步 project spec：`codestable/spec/index.md`。
- 已同步 note：`codestable/notes/005-pi-local-package-loading.md`。

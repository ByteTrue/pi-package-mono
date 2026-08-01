---
kind: issue
title: "web config 文件权限 0o600"
type: bug
status: closed
created: 2026-07-11
epic: ""
---

# web config 文件权限 0o600

## 目标

修复后：writeConfig mode 0o600 + 原子写

## 归属

- 独立 issue
- 相关 spec：`.cs/spec/pi-web-search/index.md`（atomic 亦涉及 vendor）

## 当前证据

- 预期行为：安全/正确的配置与网络边界
- 实际行为（修复前）：config.json 默认 umask 可能暴露 key
- 原始证据：`.cs/archive/codestable-legacy/issues/2026-07-11-web-config-key-perms/` 与对应 audits

## 反馈回路

- 命令：`npm --workspace @bytetrue/pi-web-search test` 与/或 vendor test
- 最近一次结果：关闭时通过

## 复现与最小化

见 archive fix-note / analysis。

## 根因定位

- 根因摘要：config.json 默认 umask 可能暴露 key

## 修复方案

writeConfig mode 0o600 + 原子写

## 验证

- web-search 测试通过

## 执行记录

- 从旧 CodeStable issue 迁移为 closed bug；代码已在 main

## 顺手发现

- 无新开

## 关闭回写

- project spec：web-search / vendor 安全与配置约定
- notes：atomic-config-0o600、web-search-package-proxy（相关项）

## 关闭结论

- 根因摘要：config.json 默认 umask 可能暴露 key
- 修复摘要：writeConfig mode 0o600 + 原子写
- 验证摘要：web-search 测试通过
- 遗留事项：仍允许明文 key 落盘

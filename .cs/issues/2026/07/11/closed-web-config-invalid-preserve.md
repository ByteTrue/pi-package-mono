---
kind: issue
title: "/web 无效配置不覆盖"
type: bug
status: closed
created: 2026-07-11
epic: ""
---

# /web 无效配置不覆盖

## 目标

修复后：readConfigResult + /web fail-closed

## 归属

- 独立 issue
- 相关 spec：`.cs/spec/pi-web-search/index.md`（atomic 亦涉及 vendor）

## 当前证据

- 预期行为：安全/正确的配置与网络边界
- 实际行为（修复前）：readConfig 三态丢失导致 /web 用 {{}} 覆盖坏文件
- 原始证据：`.cs/archive/codestable-legacy/issues/2026-07-11-web-config-invalid-preserve/` 与对应 audits

## 反馈回路

- 命令：`npm --workspace @bytetrue/pi-web-search test` 与/或 vendor test
- 最近一次结果：关闭时通过

## 复现与最小化

见 archive fix-note / analysis。

## 根因定位

- 根因摘要：readConfig 三态丢失导致 /web 用 {{}} 覆盖坏文件

## 修复方案

readConfigResult + /web fail-closed

## 验证

- config/tools 测试

## 执行记录

- 从旧 CodeStable issue 迁移为 closed bug；代码已在 main

## 顺手发现

- 无新开

## 关闭回写

- project spec：web-search / vendor 安全与配置约定
- notes：atomic-config-0o600、web-search-package-proxy（相关项）

## 关闭结论

- 根因摘要：readConfig 三态丢失导致 /web 用 {{}} 覆盖坏文件
- 修复摘要：readConfigResult + /web fail-closed
- 验证摘要：config/tools 测试
- 遗留事项：不自动修复坏文件

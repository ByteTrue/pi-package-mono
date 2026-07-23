---
kind: issue
title: "快改：补 root README 的 background-terminal 入口"
type: ff
status: closed
created: 2026-07-23
---

# 快改：补 root README 的 background-terminal 入口

## 做了什么

- 在根 `README.md` 的 packages 表补上 `@bytetrue/pi-background-terminal`
- 在 local development 段补上本地安装示例
- 在 package-level test 示例里补上 `@bytetrue/pi-background-terminal`

## 改了哪些

- `README.md`

## 怎么验证

- 读回 `README.md`，确认 packages 表、local install 示例、workspace test 示例都已包含 `pi-background-terminal`
- `git diff --check` 通过

## 对 `.cs/` 的影响

- 留下这条 `ff` 痕迹；project/package spec 无需改动

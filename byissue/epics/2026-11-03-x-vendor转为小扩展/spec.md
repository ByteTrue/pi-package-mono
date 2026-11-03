---
kind: epic
title: "vendor 转为 Pi 小扩展"
created: 2026-11-03
---

# vendor 转为 Pi 小扩展

## 要改变什么

此前把 vendor 当作通用 Skill 迁入 Satchel 是错误边界：vendor 必须拥有 Pi 的 `models.json` 事务和 `/vendor` TUI。用户确认新形态为本仓 single-file small-extension，允许 Node builtins 与 Pi 宿主 imports。

## 当前方案

- `small-extensions/pi-vendor/pi-vendor.ts` 单文件包含原 `/vendor` TUI、catalog/discovery 与 models.json optimistic-lock 事务；同一安装器还在扩展旁提供 relative bundled scripts；原提示词内嵌并由 `/vendor-ai` 命令发送给 Agent，不使用原生 Skill。
- 只允许 Node builtins 与 Pi 宿主包 imports，不依赖原 package 或本仓其他文件。
- `types/` 声明仅用于开发测试，不由安装器分发；strict 配置不放松。
- 原提示词内嵌，`vendor.mjs` CLI 作为 relative resource 保留；npm release 路径退役，旧 npm 版本不动。
- Satchel 删除 vendor Skill 与本机注册，只保留 MCP；本机改为安装小扩展 `/vendor`。
- README/AGENTS/Spec/安装器列出 pi-vendor；release workflow 不新增 vendor tag。

## 推进视图

1. [001 合并 vendor 为单文件小扩展](issues/001-x-合并vendor为单文件小扩展.md)

## 验收

strict typecheck 和原核心/prompt-command/CLI 测试通过；安装器 gate、全 workspace 测试通过；真实 Pi 能加载 `/vendor` 并调用 `/vendor-ai`，非 TUI 模式明确降级。完整交互式 TUI 未实测时不得声称已覆盖。关闭需用户明确授权。

## 关闭结论

Issue 001 已交付关闭，`pi-vendor` 小扩展形态与小扩展导入边界已毕业到 Project Spec，经用户授权关闭。

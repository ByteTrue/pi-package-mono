---
kind: epic
title: "退役已迁移扩展"
created: 2026-11-03
---

# 退役已迁移扩展

## 要改变什么

pi-image-gen、pi-vision、pi-web-search 的能力已由 Satchel 接管；pi-vendor 按后续明确决策改为本仓 small-extension。本仓只保留 pi-background-terminal、pi-subagent 与 small-extensions，从当前源码树退役旧 package，避免两套实现继续漂移。

已发布到 npm 的历史版本不删除、不 deprecate、不要求用户迁移；本机四个旧包已卸载，Satchel MCP/Skill 已实际接管。历史 Epic/Issue 保留为证据，不改写。

## 当前方案

- 删除四个旧 `packages/` 目录；image-gen/vision/web-search 删除现行子 Spec，vendor 子 Spec 改写为 small-extension 形态。
- README/AGENTS/Project Spec 改为两个发布包 + small-extensions。
- CI 删除 vendor pack 和 image-gen pack smoke；release workflow 移除四个旧 tag，保留 background-terminal/subagent。
- 更新 npm lockfile 并验证剩余 workspaces 的 typecheck/test、README gate 和 CI 静态检查。
- 不修改 Satchel、npm registry、旧配置备份或历史记录。

## 推进视图

1. [001 删除四个已迁移包并收敛工作流](issues/001-x-删除四个已迁移包并收敛工作流.md)

vendor 不迁往 Satchel 的修正及 small-extension 实现见 [vendor 转为 Pi 小扩展](../2026-11-03-x-vendor转为小扩展/spec.md)。

## 验收

`packages/` 只有 background-terminal/subagent；vendor 仅以 small-extension 存在。README gate、npm typecheck/test 和 actionlint 通过；不再存在指向旧普通包的当前 CI/release/安装指令。关闭需用户明确授权。

## 关闭结论

Issue 001 已交付关闭，仓库包结构与迁移说明已毕业到 Project Spec 与 README，经用户授权关闭。

---
id: "064"
title: "fix: ensure reliable parent session model inheritance and prevent fallback to sonnet"
type: ff
status: closed
created_at: "2026-09-03T15:00:00Z"
closed_at: "2026-09-03T16:50:00Z"
---

# 064 · Ensure reliable parent session model inheritance

## 做了什么
- 解决未显式指定模型时子进程偶尔回退到 Pi 官方默认 `claude-sonnet-5` 的问题。
- 实现 4 层父会话模型解析防线：
  1. `tool.execute` 传入的 `ctx.model`
  2. 实时事件监听（`session_start`, `before_agent_start`, `model_select`）追踪的当前活动会话模型
  3. 环境变量 `PI_PROVIDER` 与 `PI_MODEL`
  4. Pi `settings.json` 全局 `defaultProvider` / `defaultModel`
- 兼容读取 `settings.json` 中历史 `subagents.agentOverrides` 角色配置。
- 保证 `buildPiArgs` 始终为子进程显式传入 `--model <provider/id>`，防止子进程 CLI 无参自选默认模型。

## 改了哪些
- `packages/pi-subagent/src/settings.ts`
- `packages/pi-subagent/src/index.ts`
- `packages/pi-subagent/src/index.test.ts`
- `packages/pi-subagent/package.json`

## 怎样验证
- `npm run typecheck --workspace @bytetrue/pi-subagent` → 通过
- `npm run test --workspace @bytetrue/pi-subagent` → 16/16 通过
- `npm test` → 全 monorepo 13 套测试套件 100% 通过

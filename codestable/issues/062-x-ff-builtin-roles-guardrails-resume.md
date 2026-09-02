---
id: "062"
title: "feat: built-in scout/researcher/reviewer presets with 20m timeout, 50 turns limit and native session resume"
type: ff
status: closed
created_at: "2026-09-02T22:30:00Z"
closed_at: "2026-09-02T22:50:00Z"
---

# 062 · Built-in roles, guardrails & session resume

## 做了什么
- 在 `@bytetrue/pi-subagent` 中内置 3 大经典角色预设（`scout`, `researcher`, `reviewer`），开箱即用，同时支持本地文件覆盖。
- 引入安全防爆门：默认超时 20 分钟（1,200,000 ms），默认最大轮次 50 轮，超时/超轮次时安全暂停并提示可恢复。
- 接入 Pi 原生 `--session-id` 与 `--session` 断点续跑机制，支持通过 `resume: "<sessionId>"` 携带全量历史上下文无缝续接。
- 完善 `subagent` 统一纯粹任务模型与 `/subagent` 交互命令。

## 改了哪些
- `packages/pi-subagent/src/index.ts`
- `packages/pi-subagent/src/builtin-agents.ts`
- `packages/pi-subagent/src/settings.ts`
- `packages/pi-subagent/src/command.ts`
- `packages/pi-subagent/src/index.test.ts`
- `packages/pi-subagent/package.json`
- `packages/pi-subagent/README.md`
- `codestable/spec/pi-subagent/index.md`

## 怎样验证
- `npm run typecheck --workspace @bytetrue/pi-subagent` → 通过
- `npm run test --workspace @bytetrue/pi-subagent` → 12/12 通过
- `npm test` → 全 monorepo 13 套测试套件 100% 通过

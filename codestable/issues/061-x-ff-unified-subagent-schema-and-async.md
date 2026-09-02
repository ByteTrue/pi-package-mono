---
id: "061"
title: "feat: unified subagent tasks schema with async background execution"
type: ff
status: closed
created_at: "2026-09-02T22:00:00Z"
closed_at: "2026-09-02T22:15:00Z"
---

# 061 · Unified subagent schema and async background execution

## 做了什么
- 彻底重构 `@bytetrue/pi-subagent` 工具契约，消除顶层与数组字段冗余，收敛为严格纯粹的 `tasks` 任务对象数组（`Array<{ task, agent?, model?, thinking?, tools?, cwd? }>`）。
- 消除 `mode: single / parallel` 伪需求，默认并发执行（1 个即为 single，多个即为 parallel），提供显式 `chain: true` 管道流水线开关。
- 新增 `async: true`（后台非阻塞异步执行）机制，任务完成后通过 `followUp + triggerTurn` 自动唤醒主会话并交付产物。
- 会话生命周期联动与状态栏计数器（`sub:N`），支持 `session_shutdown` 安全清理。

## 改了哪些
- `packages/pi-subagent/src/index.ts`
- `packages/pi-subagent/src/index.test.ts`
- `packages/pi-subagent/package.json`
- `packages/pi-subagent/README.md`
- `codestable/spec/pi-subagent/index.md`

## 怎样验证
- `npm run typecheck --workspace @bytetrue/pi-subagent` → 通过
- `npm run test --workspace @bytetrue/pi-subagent` → 10/10 通过
- `npm test` → 全 monorepo 13 套测试套件 100% 通过

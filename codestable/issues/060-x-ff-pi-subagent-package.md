---
id: "060"
title: "feat: add lightweight pi-subagent package adapted from trellis"
type: ff
status: closed
created_at: "2026-09-02T16:00:00Z"
closed_at: "2026-09-02T16:35:00Z"
---

# 060 · Lightweight pi-subagent package

## 做了什么
- 新增 `packages/pi-subagent` 扩展包 (`@bytetrue/pi-subagent@0.3.0`)。
- 复用 Trellis 的核心子进程 JSON 流式通信引擎与差分 TUI 卡片渲染器。
- 解耦所有 Trellis 专有 Python 脚本及 `.trellis` 目录依赖，使其成为零依赖、通用独立的轻量 Subagent 工具。
- 支持 `single`、`parallel`、`chain` 模式，支持自定义 `model`、`thinking`、`tools` 过滤及 `.pi/agents/*.md` 模板定义。

## 改了哪些
- `packages/pi-subagent/package.json`
- `packages/pi-subagent/tsconfig.json`
- `packages/pi-subagent/src/index.ts`
- `packages/pi-subagent/src/index.test.ts`
- `packages/pi-subagent/README.md`
- `codestable/spec/index.md`
- `codestable/spec/pi-subagent/index.md`

## 怎样验证
- `npm run typecheck --workspace @bytetrue/pi-subagent` → 通过
- `npm run test --workspace @bytetrue/pi-subagent` → 5/5 通过
- `npm test` → 全 monorepo 所有 13 个测试套件全量通过

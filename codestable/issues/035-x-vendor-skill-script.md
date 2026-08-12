---
kind: issue
title: "pi-vendor 用 Skill 脚本取代常驻 AI tools"
type: refactor
status: closed
created: 2026-08-03
epic: "codestable/epics/003-x-vendor-ai-first/spec.md"
labels: [pi-vendor, simplification, skill]
---

# pi-vendor 用 Skill 脚本取代常驻 AI tools

## 目标

日常 provider/model 配置不再通过三个常驻 extension tools 暴露 schema 或绑定 Pi runtime；Skill 只在需要时执行 bundled script。

## 当前问题

`vendor_catalog_search`、`vendor_discover`、`vendor_validate` 常驻模型上下文，并让本可由脚本完成的读取能力耦合到 Pi tool API。

## 行为保持

- `/vendor` 冷启动 TUI 保持不变。
- catalog、discover、本地 lint 与用户终端无回显 key 输入能力保持。
- key 不进入 chat、argv 或脚本输出。

## 影响范围

- 删除三个 tool、注册与 `typebox` peer。
- bundled `vendor.mjs` 提供 `catalog`、`discover`、`lint`、`set-key`。
- AI 只执行前三项；`set-key` 只由用户终端执行。

## 方案判断

一个按需 Node `.mjs` 是最小充分方案：Pi 必然有 Node，无需复制 Python runtime 假设；`lint` 明确只做本地结构检查，不冒充 runtime registry validation。

## 验证

extension 单测确认只注册 `/vendor`；packed package 中脚本可执行；四个子命令有聚焦测试，credential 不进入 stdout。全 workspace checks、pack dry-run、RPC Skill 发现与独立 review 均通过。

## 执行记录

删除 `src/tools.ts`、tool tests/registration 与 `typebox` peer；脚本覆盖 catalog/discover/lint/set-key，并保留 HTTP、redirect、timeout、body size、credential echo、atomic key write 与并发保护边界。

## 关闭回写

- epic spec：`codestable/epics/003-x-vendor-ai-first/spec.md`
- project spec：`codestable/spec/pi-vendor/index.md`

## 关闭结论

常驻 vendor tools 已归零；AI-facing 能力变为 Skill 内按需脚本，TUI 行为保持。

---
title: "pi-vendor 用 Skill 脚本取代常驻 AI tools"
status: closed
created: 2026-08-03
labels: [pi-vendor, simplification, skill]
---

# pi-vendor 用 Skill 脚本取代常驻 AI tools

## 原因

owner 验收 Skill 后指出：`vendor_catalog_search`、`vendor_discover`、`vendor_validate` 三个 extension tools 会把 schema 常驻模型上下文，并把日常配置能力不必要地耦合到 Pi tool/runtime API。此处是过度设计；Skill 内按需执行脚本即可。

## 范围

- 删除三个 tool、注册与 typebox peer；extension 只保留 `/vendor`。
- bundled script 合并为 `scripts/vendor.mjs`：`catalog`、`discover`、`lint`、`set-key`。
- AI 只执行前三项；`set-key` 仍由用户在自己的终端执行，不把 key 放进 chat/argv。
- `lint` 明确只做本地结构检查，不冒充 runtime registry validation。
- TUI 继续使用现有 TypeScript core，不在本次重写已验证的冷启动路径。

## 验收

- package/skill 被发现，但 extension tool 列表无 vendor tools。
- packed package 中脚本可直接执行。
- catalog/discover/lint/set-key 有聚焦测试；secret 不进入 stdout。
- typecheck、全 package tests、pack dry-run 通过。

## 完成

- 删除 `src/tools.ts`、tools tests、tool registration 与 `typebox` peer；extension 单测确认只注册 `/vendor`。
- `scripts/vendor.mjs` 覆盖 catalog/discover/lint/set-key；AI 按需执行前三项，key 仍由用户终端无回显输入。
- discovery 对 HTTP/redirect/timeout/body size 做边界检查，支持 Pi-style env/command/literal credential，并对所有已配置/解析凭据做上游 echo fail-closed。
- lint 不输出 provider/model 原值，避免错误诊断复现 key；明确只做本地检查。
- active Pi catalog probe、Windows npm shim fixture、stream failure redaction、atomic key write/并发保护均有测试。
- 独立验收：blocking 0 / important 0。
- 验证：全 workspace typecheck/test；pi-vendor 20 files / 195 tests；pack manifest 含 `vendor.mjs`；RPC 发现 `/vendor` 与 `skill:pi-vendor`。

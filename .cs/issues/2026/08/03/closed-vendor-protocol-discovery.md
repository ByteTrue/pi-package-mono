---
title: "pi-vendor discovery 支持异构 API 路由"
status: closed
created: 2026-08-03
labels: [pi-vendor, bug, discovery]
---

# pi-vendor discovery 支持异构 API 路由

## 症状

Skill audit 对混合 OpenAI/Anthropic/Google model-level route 的 provider 只请求一次 OpenAI-compatible `/models`，随后错误输出“configured but absent upstream”。Owner 指出模型探查不应只支持 OpenAI 格式。

## 根因

脚本与 TUI bounded-discover 都固定 append `/models`、Bearer auth、解析 `data[].id`，忽略 provider/model 的 `api`、model-level `baseUrl/headers` 与 provider `authHeader`。此外，list endpoint 缺失只能作为无结果，不能作为上游不支持模型的负面证据。

## 修复

- OpenAI-compatible、Anthropic Messages、Google Generative AI 分别使用协议对应 URL/auth/response shape；unknown/custom 保持 OpenAI-compatible fallback。
- Skill script `discover <provider> [configured-model-id]` 支持指定模型 effective route；异构 provider 按 route 分组探查。
- TUI bounded-discover 按 provider API 探查并尊重 `authHeader`。
- Skill 明确 discovery 只提供 positive evidence，禁止用 list difference 断言模型不可用。

## 验收

- 三种 API 的 URL、auth、response parser 有测试。
- model-level route、explicit auth/authHeader 与 credential redaction 保持正确。
- 全 package tests/typecheck/pack 通过；独立 review blocking/important 为零。

## 完成

- `vendor.mjs discover <provider> [configured-model-id]` 按 effective route 探查；OpenAI、Anthropic、Google 使用各自 URL/auth/response shape，provider `authHeader` 按 Pi 语义额外添加 Bearer 而不替代 native auth。
- TUI bounded-discover 同步支持三种协议，unknown/custom 保持 OpenAI-compatible fallback。
- Skill 明确 list 结果只作 positive evidence，禁止再用缺集推断“上游不支持”。
- 真机对 `bytetrueapi` 验证：OpenAI route 列 17 个、Anthropic route 列 7 个、Google route 列 3 个；原报告中 Claude/Qwen/Gemini 的“上游没列出”是单路由误判。
- 验证：全 workspace typecheck/test；pi-vendor 20 files / 200 tests；pack manifest 通过；独立 reviewer blocking=0、important=0。
- 真实 Pi 0.82.1 非交互 E2E 三轮通过：显式要求 Skill 与自然中文自动触发均读取包内 `SKILL.md`，四条 route 全部探查成功，0 tool errors、0 credential occurrence、0 writes。第二轮自动触发报告发现一次长列表手工转录重复及 Python 假设，Skill 随即要求用 Node 做临时检查并保持脚本返回的 unique IDs/count；第三轮回归确认只用 Node、两个相同 OpenAI route 不再重抄列表、ID/count 准确。

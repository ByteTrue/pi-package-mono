---
kind: issue
title: "pi-vendor discovery 支持异构 API 路由"
type: bug
status: closed
created: 2026-08-03
epic: "codestable/epics/003-x-vendor-ai-first/spec.md"
labels: [pi-vendor, bug, discovery]
---

# pi-vendor discovery 支持异构 API 路由

## 目标

混合 OpenAI、Anthropic、Google route 的 provider 必须按每个模型的 effective route 探查；列表缺失只作为待验证异常，不直接推断模型不可用。

## 当前证据

- 预期行为：按 effective `api/baseUrl/headers` 使用协议对应的 list endpoint、认证与 response shape。
- 实际行为：Skill audit 只请求一次 OpenAI-compatible `/models`，随后把 Claude、Qwen、Gemini 错报为上游未列出。
- 原始证据：`bytetrueapi` 真机配置与 list endpoint 结果。

## 根因定位

脚本与 TUI bounded-discover 固定 append `/models`、Bearer auth、解析 `data[].id`，忽略 provider/model 的 `api`、model-level `baseUrl/headers` 与 provider `authHeader`。

## 修复方案

- OpenAI-compatible、Anthropic Messages、Google Generative AI 分别使用协议对应 URL、auth 和 response shape；unknown/custom 使用 OpenAI-compatible fallback。
- `discover <provider> [configured-model-id]` 按模型 effective route 探查；异构 provider 由 Skill 分组。
- 返回 ID 作为 positive evidence；配置存在但 route 未列出时提醒进一步验证，禁止自动删除或改路由。

## 验证

三种 API、model-level route、`authHeader`、credential redaction 均有测试。真机结果：OpenAI 17 个、Anthropic 7 个、Google 3 个；Pi 0.82.1 非交互 E2E 三轮通过，0 tool errors、0 credential occurrence、0 writes。全 workspace checks、pack 与独立 review 通过。

## 执行记录

脚本与 TUI discovery 已统一支持三种协议；Skill 已记录 list endpoint 的证据等级与缺失提醒规则。

## 关闭回写

- epic spec：`codestable/epics/003-x-vendor-ai-first/spec.md`
- project spec：`codestable/spec/pi-vendor/index.md`

## 关闭结论

根因已在共享 discovery 语义中消除，异构 route 不再被单个 OpenAI 列表误判。

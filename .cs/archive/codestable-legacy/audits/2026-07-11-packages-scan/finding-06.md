---
doc_type: audit-finding
audit: 2026-07-11-packages-scan
finding_id: "maintainability-02"
nature: maintainability
severity: P2
confidence: medium
suggested_action: cs-refactor
status: superseded
---

# Finding 06：默认 provider 注释过时（与 Finding 04 同源，维护向）

## 速答

除行为文档外，包入口与工具模块的模块级说明仍把 DuckDuckGo 标成 default，与 registry 真源分叉，属于“双源真相”维护债。

## 关键证据

- 真源：`packages/pi-web-search/src/providers/registry.ts:9` `DEFAULT_PROVIDER_NAME = "bing"`
- 过时：`packages/pi-web-search/src/index.ts:1-7`、`packages/pi-web-search/src/tools.ts:1-7`
- 另：`packages/pi-web-search/src/providers/duckduckgo.ts:1-3` 仍写 “zero-config default search provider”

## 影响

- 与 Finding 04 同一根因；修注释一次即可消掉两条中的文档半边
- 建议与 04 合并处理，不单开大重构

## 建议动作

`cs-refactor` 或随 Finding 04 的 `cs-issue` 一起改文案；考虑模块注释只引用 `DEFAULT_PROVIDER_NAME`，避免再写死名字。


## 后续

上游改为 default `exa-free` 并删除 DDG；本 finding 的“注释写 DDG/Bing”已过期，以 registry 为准。

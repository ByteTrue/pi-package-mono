---
doc_type: audit-finding
audit: 2026-07-11-packages-scan
finding_id: "bug-02"
nature: bug
severity: P2
confidence: high
suggested_action: cs-issue
status: superseded
---

# Finding 04：文档/注释仍写默认 DuckDuckGo，实际默认 Bing

## 速答

运行时 `DEFAULT_PROVIDER_NAME = "bing"` 且测试/README 表格已更新，但多处源码顶栏注释仍称默认 DuckDuckGo，排障时会查错网络/代理路径。

## 关键证据

- `packages/pi-web-search/src/providers/registry.ts:9` — `export const DEFAULT_PROVIDER_NAME = "bing"`
- `packages/pi-web-search/src/config.test.ts:7-8` — 断言 unset 时为 bing
- `packages/pi-web-search/src/index.ts:4-6` — 注释写 “default provider is keyless DuckDuckGo”
- `packages/pi-web-search/src/tools.ts:4-6` — 同样写 default DuckDuckGo
- `packages/pi-web-search/README.md:10` — 已正确写 Bing default（不一致只在代码注释）

## 影响

- 开发者/agent 读源码注释会误判默认后端与 CN 代理需求
- 不改变运行行为，属文档一致性 bug

## 建议动作

`cs-issue`：改 index.ts / tools.ts / duckduckgo.ts 顶部文案，统一 “default = Bing，DDG 为可选 keyless”。


## 后续

上游改为 default `exa-free` 并删除 DDG；本 finding 的“注释写 DDG/Bing”已过期，以 registry 为准。

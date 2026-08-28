---
kind: issue
title: "快改：发布 ponytail-audit 清理（vendor 0.3.5 / image-gen 0.3.0 / web-search 0.4.0）"
type: ff
status: closed
created: 2026-08-29
closed: 2026-08-29
---

# 快改：发布 ponytail-audit 清理（vendor 0.3.5 / image-gen 0.3.0 / web-search 0.4.0）

## 做了什么

对全仓做 ponytail-audit（只找过度工程，不动正确性）后落地全部 8 项发现，净 `-297` 行（+133/−430）。主线是删死代码与手写基建换成平台标准件，无任何功能新增。

## 改了哪些

- `@bytetrue/pi-vendor`：`0.3.4` → `0.3.5`（patch，公开入口不变）。
  - 删除无调用方的 mutation/元数据 API（`renameProvider`、`deleteProvider`、`deleteModel`、`isUnderProviderPath`、`categorizeSecretSlot`、字段表、`classifyConfigValue`）及其测试；`config-mutations.ts` 删除，存活的 3 个 mutation 并入 `config-document.ts`。
  - `bounded-discover.ts`：~20 行手写信号组合 + 定时器换成 `AbortSignal.timeout` + `AbortSignal.any`（3 行）。
- `@bytetrue/pi-image-gen`：`0.2.1` → `0.3.0`（0.x breaking：删导出）。
  - 删除 `formatToolResultText` 兼容别名（仓库内仅自测引用），`formatImageResult` 为唯一名字。
  - `errors.ts` 复用 `models.ts` 的 `ENV_VARS`，顺带修正漏掉的 ark。
- `@bytetrue/pi-web-search`：`0.3.0` → `0.4.0`（0.x breaking：删导出类型 + 配置行为变化）。
  - 删除 `AnyProvider` 别名与无使用的 `SearchResponse` 类型。
  - `searchProviderWithTimeout` 用 `AbortSignal.timeout/any` 简化（保留 `Promise.race` 兜底不尊重 signal 的 provider）。
  - 删除旧格式 shim：单数 `provider` 与 `autoFallback` 不再读取或迁移，只认 `providers`；schema 同步移除 `provider` 字段；README 更新。

## 怎么验证

- 全仓 typecheck 通过；全仓 468 tests passed（9 个 credential-dependent live tests skipped）。
- 发布前：`pi-vendor` / `pi-web-search` pack dry-run 通过，`pi-image-gen` pack-smoke 通过。
- Release runs：`pi-vendor-v0.3.5` `33188827515`、`pi-image-gen-v0.3.0` `33188827985`、`pi-web-search-v0.4.0` `33188828097` 均 success；main CI run `33188824689` success。
- npm registry：三包新版本均存在且 `dist-tags.latest` 已指向 `0.3.5` / `0.3.0` / `0.4.0`。

## 对 `codestable/` 的影响

`pi-web-search` spec 的"写入安全"与"provider chain"条目更新：旧 `autoFallback` / 单数 `provider` 自 0.4.0 起不再读取或迁移。

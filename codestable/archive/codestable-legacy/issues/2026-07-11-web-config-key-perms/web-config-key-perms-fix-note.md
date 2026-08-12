---
doc_type: issue-fix-note
issue: 2026-07-11-web-config-key-perms
status: fixed
severity: P1
source: .codestable/audits/2026-07-11-packages-scan/finding-02.md
---

# web-config-key-perms 修复记录

## 根因

`writeConfig` 用默认 umask 写 `config.json`，可能含明文 API key。

## 改动

- `packages/pi-web-search/src/config.ts`：`writeFileSync(..., { mode: 0o600 })` + 原子 rename（与 finding-03 一并）

## 验证

web-search 全量测试通过。未强制改 `/web` UI 为只写 env 引用（更大产品改动；当前先锁文件权限）。

## 遗留

- 仍可把明文 key 写入文件；仅权限收紧。若要禁止落盘明文，另开 issue。

---
doc_type: issue-fix-note
issue: 2026-07-11-atomic-config-write
status: fixed
severity: P1
source: .codestable/audits/2026-07-11-packages-scan/finding-03.md
---

# atomic-config-write 修复记录

## 根因

`writeModelsJson` / `writeConfig` 直接覆盖目标文件，中断可能半截 JSON。

## 改动

- `packages/pi-vendor/src/models-json.ts`：写 `path.<pid>.tmp` 后 `renameSync`
- `packages/pi-web-search/src/config.ts`：同上
- 两者均 `mode: 0o600`
- `models-json.test.ts`：断言 mode 0o600

## 验证

`npm --workspace @bytetrue/pi-vendor test` — 38 passed  
`npm --workspace @bytetrue/pi-web-search test` — 38 passed

## 遗留

- 无跨进程文件锁；双会话同时 save 仍 last-write-wins

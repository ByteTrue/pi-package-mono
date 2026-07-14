---
doc_type: audit-finding
audit: 2026-07-11-packages-scan
finding_id: "bug-01"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 03：models.json / config.json 非原子写，中断或并发可损坏

## 速答

两包都直接 `writeFileSync` 覆盖目标路径，无 temp+rename；vendor 虽在 save 前 re-read，仍无文件锁，写中途崩溃会留下半截 JSON。

## 关键证据

- `packages/pi-vendor/src/models-json.ts:108-110` — `writeModelsJson` 直接写 `path`
- `packages/pi-vendor/src/command.ts:549-581` — save 时 re-read + upsert + write，无 flock/原子替换
- `packages/pi-web-search/src/config.ts:61-64` — 同样直接覆盖 `CONFIG_PATH`
- `packages/pi-web-search/src/config.ts:50-55` — 读失败/坏 JSON 对 web 是 fail-soft 成 `{}`（丢配置）；vendor 读坏 JSON 则抛错阻断 `/vendor`

## 影响

- 进程被 kill / 磁盘满时可能损坏 `models.json`（自定义 provider 全丢或 `/vendor` 起不来）
- 两会话同时 save 时后写覆盖先写，无合并
- 触发频率中低，但一旦发生是用户级配置事故

## 建议动作

`cs-issue`：`writeFileSync(tmp)` + `renameSync(tmp, path)`（同目录）；可选 `mode: 0o600`。

---
kind: issue
title: "image-gen 只改默认模型的短路径"
type: ff
status: closed
created: 2026-09-27
closed: 2026-09-27
---

# image-gen 只改默认模型的短路径

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

上新模型时只换个 model id，不必再重走完整向导：`/image-gen` 菜单新增 `Change default model`，复用已存 endpoint 与 credential 去探测模型列表，确认后只写 `defaultModel`。

- 改动：
  - `packages/pi-image-gen/src/config-command.ts` — 新增 `configuredProviders()`（有 override 或标准 env key 的 built-in + 全部 custom）与 `changeDefaultModel()` 及菜单入口；探测失败降级为该供应商已知模型或手输；custom provider 已有显式 `models` 时 upsert 选中模型并保留原 alias，catch-all provider 不物化出列表；URL/key/headers/outputDir 一律不写。
  - `packages/pi-image-gen/src/config.ts` — 导出 `resolveProviderRoute()`：不需要 model id 也能拿到已存 route。
  - `packages/pi-image-gen/scripts/pack-smoke.mjs` — 解包改为以 temp 根为 cwd 传相对 POSIX 路径，修掉 Git Bash 的 MSYS tar 把 `C:\...` 当远端 host（`Cannot connect to C:`）导致的失败。
  - `packages/pi-image-gen/README.md` — 补该入口说明。
- 验证：typecheck；`npm --workspace @bytetrue/pi-image-gen test`（99 passed，新增 8 条覆盖该路径与降级/alias/tombstone 情形）；build；`node packages/pi-image-gen/scripts/pack-smoke.mjs` 在 `/usr/bin/tar` 下 8 步全绿；用户在真实 Pi TUI 验收通过。
- byissue：已同步 `spec/pi-image-gen/index.md`（「它负责什么」新增该短路径一条）。

顺手发现（已一并修复）：任何 shell 出 `tar` 的脚本在 Windows 都不能传绝对路径——MSYS tar 与 bsdtar 行为不同，相对路径是唯一同时安全的写法。

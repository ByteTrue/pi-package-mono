---
kind: issue
title: "修 sessionLogPath Windows 测试：期望目录按 resolve() 后的路径编码"
type: ff
status: closed
created: 2026-09-23
---

# 修 sessionLogPath Windows 测试：期望目录按 resolve() 后的路径编码

`src/index.test.ts` 的 session log 用例在 Windows 上稳定失败（clean HEAD 也失败，与近期改动无关）：测试用 `cwd = "/tmp/some project"` 并硬编码期望目录 `--tmp-some project--`，而生产代码 `sessionLogPath` 先 `resolve(cwd)`——Windows 上变成 `C:\tmp\some project`，pi 的编码规则产出 `--C--tmp-some project--`。是**测试假设了 POSIX 路径**，生产实现与 pi core `getDefaultSessionDirPath`（`dist/core/session-manager.js:291`）逐字符一致，无需改。

- 改动：`packages/pi-subagent/src/index.test.ts` — cwd 改为平台无关的 `join(tmpdir(), "pi-subagent-cwd <ts>")`，期望目录按同一编码规则从 `resolve(cwd)` 计算（注释说明镜像 pi 未导出的规则）。
- 验证：全平台测试转绿——31 passed / 0 failed（此前 Windows 上 1 failed）；typecheck 通过。
- byissue：无影响（测试基础设施修正，不改行为）。

- 发布：随 `096` 一起发布于 `0.9.1`（2026-09-23，见 `096` 的发布记录）。

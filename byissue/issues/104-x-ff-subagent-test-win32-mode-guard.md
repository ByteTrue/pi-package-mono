---
kind: issue
title: "pi-subagent 权限位断言补 win32 守卫：Windows 上 npm test 恢复全绿"
type: ff
status: closed
created: 2026-10-01
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# pi-subagent 权限位断言补 win32 守卫：Windows 上 npm test 恢复全绿

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

本机（Windows）跑 `npm test` 一直是红的：`pi-subagent` 两条断言直接比较 POSIX 权限位，而 Windows 的 `statSync().mode` 恒报 `0o666`（目录也报 666，不是 700），断言必挂。这两条测试只验证 `packages/pi-subagent/src/settings.ts` 的 `mkdirSync(..., { mode: 0o700 })` / `writeSectionFile(..., 0o600)` 是否真的落到磁盘权限上——在 win32 上这个前提不成立，所以按本仓既有范式（`pi-vendor/src/config-core.test.ts:47`、`pi-vendor/src/models-json.test.ts:97`、`pi-vision/src/vision-command.test.ts:76`、`pi-image-gen/src/__tests__/settings.test.ts:104`）加 `process.platform !== "win32"` 守卫；实现代码一行未动。

- 改动：`packages/pi-subagent/src/settings.test.ts` — 用例 `creates the config root with 0700 and the file with 0600` 的三条断言（原 :80-82，现 :80-85）包进 `if (process.platform !== "win32")` 块并加一行说明注释；用例 `honors an explicit file mode instead of forcing 0600` 的 `0o640` 断言（原 :91，现 :94）改成单行守卫写法，与 pi-vendor 先例同形。
- 验证：改前 `npm --workspace @bytetrue/pi-subagent test` → `Test Files 1 failed | 2 passed (3)` / `Tests 2 failed | 52 passed (54)`，失败点为 `src/settings.test.ts:80-82`（`expected 438 to be 448` 之类）与 `:91`（`expected 438 to be 416`）；改后同命令 → 3 files / **54 passed**。单文件 `npx vitest run --root packages/pi-subagent src/settings.test.ts` → **16 passed**（`VITEST_EXIT=0`）。全仓 `npm test` → **退出码 0**（本轮改用重定向 + 显式 `$?` 采集，不再让管道吞退出码），六个 workspace 全绿（pi-background-terminal 8 files / 52 passed + 1 skipped、pi-image-gen 12 / 125、pi-subagent 3 / 54、pi-vendor 19 / 191、pi-vision 6 / 87、pi-web-search 12 + 1 skipped / 115 passed + 9 skipped）；`tsc --noEmit -p packages/pi-subagent` → 0。测试文件不在发布物里（`files` 含 `!src/**/*.test.ts`，`npm pack` 11 文件），**无需发版**。
- byissue：已同步 `byissue/notes/012-windows-tmp-divergence-and-python3-stub.md` —— 该 note 原本只记了 `/tmp` 与 `python3` 两个本机陷阱，现补第三节「`statSync().mode` 在 Windows 上恒为 0o666」，含实测输出（目录/子目录/文件全报 666）、守卫写法、五处先例与 grep 审计办法，标题相应改为「三个陷阱」。`byissue/spec/pi-subagent/index.md` 无需改：该 spec 记录工具语义，不含测试实现细节。
- 顺带更正：上一轮（`byissue/issues/103-x-ff-undici-8-11-2-and-audit-baseline.md`）与本条都靠 `npm test | tail` 观察结果，管道让退出码取自 `tail`，把 2 条红掩盖成 exit 0——**核验测试结果要读 `Test Files / Tests` 计数或 `$PIPESTATUS`，不能只看退出码**。该 2 条红也已被 ff 103 记为「已知非本次引入的失败」，本条把它清零。

顺手发现（不在本次范围）：无。

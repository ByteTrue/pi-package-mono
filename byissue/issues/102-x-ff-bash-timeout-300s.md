---
kind: issue
title: "前台 bash 超时上限 600s → 300s"
type: ff
status: closed
created: 2026-09-30
---

# 前台 bash 超时上限 600s → 300s

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

输入：用户实测前台命令卡住（一次 codemode 嵌套 bash 跑了 448.8s 才被 abort），追问「pi 给 bash 的默认上限就是 600s 对吗」——核实后确认 600s 不是 Pi 内核值（内核 bash **无默认超时**，schema 原文 "Timeout in seconds (optional, no default timeout)"；`MAX_TIMEOUT_SECONDS = 2147483.647` 只是 setTimeout 32 位毫秒溢出保护），完全来自本包 065 注入的 `SHELL_TIMEOUT_SECONDS`。用户裁决（m00109）：**降到 300s**——前台命令要么快速失败，要么转 `background_run`，600s 让跑飞命令占用一轮太久。

- 改动：`src/bash-default-timeout.ts` — `SHELL_TIMEOUT_SECONDS` 600 → 300 并 `export`（单一事实源）；注释与 `TIMEOUT_STEERING` 文案改 300s，steering 改成模板串插值常量（防再次漂移）。
- 改动：`src/tools/background-run.ts` — promptGuidelines 第五条改为 `import { SHELL_TIMEOUT_SECONDS }` 插值（原为硬编码 "600s"，正是 099 那次写反指引的同一条 guideline），不再有第二处字面量。
- 改动：`src/bash-default-timeout.test.ts` — 600 断言/文案全部改 300（注入 bash/powershell、>300 钳制、`timeout: 0` 视为缺省、waitSeconds 并存、超时错误文案与 steering 含 "hard-capped at 300s"）；≤cap 用例样本改 120 并补一条「恰好 300 原值放行」边界断言（cap 为闭区间）。
- 改动：`README.md`（:48 hook 描述、:70 "the only touch"、:73 固定默认值一行）、`package.json` description 同步。`README.md` 中 background_run 的 600s 寿命文案（:20/:40）与 `src/tools/background-run.test.ts` 的 600s 断言**不动**——那是后台任务寿命，不是前台 cap。
- 验证：`npm --workspace @bytetrue/pi-background-terminal test` 8 files / 52 passed + 1 skipped 全绿；`tsc --noEmit` 通过；变异验证——把常量改回 600 重跑，`bash-default-timeout.test.ts` 多条转红（注入/钳制/steering 文案），恢复 300 后复绿。
- byissue：已同步 `byissue/spec/pi-background-terminal/index.md`（定位、hook 小节标题与正文、promptGuidelines 第五条、明确不做、使用路径表、实现地图共 7 处）与 `byissue/spec/index.md`（2 处前台 hook 描述）。

发布：**未做**。本包 npm 上仍是 0.9.0（600s），需要 bump + tag `pi-background-terminal-v*` 才生效；本机 `~/.pi/agent/npm` 也需相应更新。

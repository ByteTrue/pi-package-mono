---
kind: issue
title: "pi-browser Status 误报 agent-browser not found（Windows .cmd 垫片）"
type: ff
status: closed
created: 2026-09-15
---

# pi-browser Status 误报 agent-browser not found（Windows .cmd 垫片）

`/browser → Status` 在 CLI 已安装时显示 "not found (no output (exit code 1))"。根因：`pi.exec` 以 `shell: false` spawn，Windows 上 npm 全局的 `agent-browser` 是 `.cmd` 垫片，不经 shell 无法拉起。修复：新增 `src/cli.ts` 统一解析可直接 spawn 的目标（原生平台二进制优先，其次 node 跑包内 JS 入口），版本探测与全部 session 命令共用；Windows 永不解析无扩展名 sh 垫片。

- 改动：`packages/pi-browser/src/cli.ts`（新增）、`src/env.ts`、`src/sessions.ts` — 探测与 session/close/doctor 全部走解析器。
- 改动：`src/env.test.ts`、`src/sessions.test.ts`、`src/browser-command.test.ts` — 解析器单测（homedir mock、shim 排除、缺失提示）+ 用 `shell:false` 真实 spawn 的回归测试。
- 验证：35 项包测试 + typecheck + pack 通过；本机 `agent-browser 0.37.1` 经 `shell:false` spawn 探测 ready。
- codestable：已同步 `codestable/spec/pi-browser/index.md`（新增 CLI 解析小节）。

## 发布记录（2026-09-15）

- `0.3.1`（提交 `bf2ed1b`，tag `pi-browser-v0.3.1`）：修复本体；CI 首次暴露 probe 测试在无安装机器上误走真实解析（ready 用例读到 missing），Release/CI 双红，未发布。
- `0.3.2`（提交 `7e5f018`，tag `pi-browser-v0.3.2`）：为 probe 测试注入文件级 CLI override，需要真实解析的用例局部清除；Release run 成功，registry `latest = 0.3.2`。
- 教训：依赖“本机恰好装了 CLI”的测试在 CI 上不可重现；涉及环境探测的用例必须显式控制解析结果（override），只把真实 spawn 作为有前置条件的回归用例。

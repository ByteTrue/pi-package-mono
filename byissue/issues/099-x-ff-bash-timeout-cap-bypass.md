---
kind: issue
title: "bash 超时兜底防绕过：钳制显式大 timeout + 修正写反的指引"
type: ff
status: closed
created: 2026-09-17
---

# bash 超时兜底防绕过：钳制显式大 timeout + 修正写反的指引

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

真实事故（2026-09-17 报告，另一台 Windows 机器，装的是最新 0.8.1）：模型多次执行阻塞命令，bash 卡几十分钟，600s 兜底未生效。根因链：079 的 P1 意图是「超时失败引导向 background_run」，但写进 `background-run.ts` guideline 的措辞方向反了（"pass a larger timeout to bash"），教模型显式传大 timeout；065 钩子按设计「显式传参尊重原值」，被一句话绕过（上界 2^31ms≈24.8 天）。注入链路本身在 pi 0.87.1 核心完好（`beforeToolCall` → `emitToolCall` 原地改 `event.input`），无回归。

用户裁决（同日）：保持 079 的「不覆盖内建工具」边界不变，在不覆盖的前提下把防线加到最厚；另要求 background_run 也加硬上限（「超时当续期，比无限跑合适」）。故本 ff 共四层：

1. 指引修正（恢复 079 原意图）；
2. 钳制：显式 `timeout > 600` 钳到 600，600 成为前台命令寿命硬上限；
3. 失败瞬间引导：`tool_result` 钩子在超时错误后追加 steering 块（079 审计推迟的方案，事故证明需要）；
4. background_run 硬上限 3600s：显式值超过被钳；`timed_out` 通知文案改为续期表述（restart to renew）；description/guideline/schema 同步改。上限理由：任务随 session_shutdown 清理，本就活不过会话，上限钳的是会话内僵尸的资源天花板；3600s 覆盖任何本地 build/test，dev server 靠通知-重启循环续期；0.8.x 教的 86400 是幻影保护（会话几乎不满一天）。

- 改动：
  - `src/bash-default-timeout.ts` — 缺省注入 600 不变；钳制显式大值；新增 `tool_result` 钩子：bash/powershell 的超时错误后追加「上限 600s、长命令走 background_run、挂起先查因再重试」引导，回传 details/isError/usage 防丢失（agent-session 对 hook 结果是替换不是合并）。
  - `src/tools/background-run.ts` — guideline 第五条修正为 079 原意图：需要更长命令改用 background_run，不再教模型给 bash 传大 timeout；新增 `HARD_CAP_LIFETIME_SECONDS = 3600` 钳制（含 rationale 注释）；timeout 相关 description/guideline/schema 改为「默认 600，上限 3600，超时通知即续期信号」。
  - `src/index.ts` — timed_out 通知文案改为续期表述（"restart with background_run to renew it"）。
  - `src/tools/background-run.test.ts` — 「显式 timeout 全尊重」改为「≤3600 尊重 / 86400 钳到 3600 且返回文本回显 Hard timeout: 3600s」。
  - `src/bash-default-timeout.test.ts` — 「显式尊重原值」改为「>600 钳到 600」；新增 ≤600 尊重、`timeout: 0` 视为缺省、steering 四用例（追加+回传/powershell 同款/非错误与非超时错误不动/他工具不动）。
  - `src/index.test.ts` — 事件断言加 `tool_result`。
  - `README.md`、`byissue/spec/pi-background-terminal/index.md` — 语义同步。
- 验证：本包 vitest 8 files / 53 tests 全绿；`tsc --noEmit` 通过；变异验证四项（去钳制→红；去 isError 守卫→红；改坏错误模式→红；去 3600 钳制→红；恢复均→绿）。需要真实 Pi 回归确认模型行为后再发布 0.9.0（行为变化：bash 显式大 timeout 钳到 600、background_run 显式大 timeout 钳到 3600，属 minor）。
- byissue：已同步 `byissue/spec/pi-background-terminal/index.md`（600s hook 语义三层防线、promptGuidelines 第五条描述）。

顺手发现（可选）：`agent-browser open` 首次建会话挂起是那台机器上更上游的触发源，属 agent-browser skill 范畴，不在本包范围。

## 发布

- 版本 `0.8.1` → `0.9.0`（minor：bash 显式大 timeout 钳到 600、background_run 硬上限 3600 + 续期语义，均为行为变化；description 同步重写）。
- commit `334510a`（rebase 过 2cafa1d）推送 origin/main；tag `pi-background-terminal-v0.9.0` 触发 `release.yml`（run `36516240240`）：typecheck → npm test → OIDC Trusted Publishing 全部 ✓，provenance 入 transparency log（logIndex 2992501668）。
- npm 已生效：`latest = 0.9.0`；tarball 反验 10 文件干净（钳制逻辑在包内，零测试泄漏）。
- 本机全局包（`~/.pi/agent/npm`）已更新至 0.9.0；**另一台 Windows 机器需用户自行更新**（仍 0.8.1，写反的指引仍在教模型传大 timeout）。

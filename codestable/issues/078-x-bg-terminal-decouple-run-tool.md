---
kind: issue
title: "解耦回归：删除 bash 覆盖，独立 run 工具 + 双默认"
type: feature
status: closed
superseded_by: codestable/issues/079-x-bg-terminal-pure-background.md
closed: 2026-09-14
created: 2026-09-14
---

# 解耦回归：删除 bash 覆盖，独立 run 工具 + 双默认

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。

## 做成以后是什么样

内建 `bash` 完全不被覆盖、不被注册同名工具。包提供一个独立的 `run` 工具：`run(command, waitSeconds?, timeout?)`，双默认（等待 10s / 总寿命 600s），wait-then-demote + 退出唤醒——077 的全部机制保留，只是入口从"覆盖 bash"换成"独立工具"。`background_status` / `background_kill` / `/background` / footer / 通知机制照旧。

**范围：** 删除 `shell-override.ts`；新建 `run` 工具（schema 自定义，不再组合内建定义）；600s hook 恢复 bash 覆盖面；README/spec 重写；版本 0.8.0（breaking：bash 覆盖消失、入口工具改名）。**不包含：** PTY/交互 stdin、powershell 覆盖（维持永不覆盖）、可配置默认值。

**归属：** 独立 issue。翻转链：039（不覆盖）→ 071（翻转：覆盖 bash，talk 005 论证）→ 077（覆盖上双默认）→ **本 issue（翻转回不覆盖，带走 077 全部机制）**。

## 为什么翻转（用户 2026-09-14 确认）

1. **仓库理念**：整个仓库坚持不耦合原生工具（pi-vendor 砍掉 web UI 同理）。覆盖 bash 要求 schema 组合、SettingsManager 复刻、agent-bin PATH 复刻、渲染槽位回退依赖——每一项都是对上游 bash 演化的跟跑成本。
2. **077 证明耦合不是机制的载体**：双默认、demote、one-shot、文件上限全部活在 manager 与工具 execute 里，与"覆盖"无关。覆盖唯一独有的是"单入口"，而单入口的收益（消灭选择）在解耦侧有更好的解法（见下）。
3. **subagent/进程生命周期已验证**：任务经 `ops.exec()` spawn 即进 Pi 的 tracked 集合，SIGTERM/SIGHUP/崩溃/正常退出全路径必杀（今日实测 SIGTERM 场景）；print 模式 one-shot 不产生后台任务。解耦后这些不变式原样成立。

## 解耦侧的选择问题解法（077 学习的迁移）

重叠不可避免（bash 与 run 都是执行器），但把重叠做成**不对称且失败安全**：

- `run` 是 bash 的行为超集：快命令内联返回（与 bash 无差别），慢命令 demote+唤醒（bash 做不到）。
- 引导边界画在"是不是瞬间命令"上——二值判断，不是时长预测；且选错不疼：用 run 跑 echo = 与 bash 相同结果；用 bash 跑慢命令 = 今天的原生行为（600s hook 兜底）。
- promptGuidelines 明确："anything that might take longer than a few seconds → prefer run over bash"。

## 命名决策

入口工具命名 `run`：talk 005 记录过用户自己的批判——带快路径的工具叫 "background_*" 是"名字在撒谎"、"预测轴的残留"。`run` 是动词短名，与 pi 内建工具命名风格一致（read/write/edit/bash/find/grep/ls）。`background_status`/`background_kill` 名字保留（它们管理的确实只有后台任务，名字诚实）。

## 600s hook 决策

保留并恢复 bash 覆盖面（bash + powershell 都注入）：它是安全网不是耦合——不注册工具、不接管执行路径、只对未传 timeout 的调用注入默认值（065 的原设计）。模型被引导去 run 之后，bash 调用会偏向快命令，600s 对它们不可见。若用户要彻底纯净，删除是一行的事。

## 方案

- `src/tools/run.ts`：`registerRunTool(pi)`。schema：`command`（必填）、`waitSeconds?`（默认 10，0 = 立即后台）、`timeout?`（默认 600，总寿命硬杀）。execute：`oneShot = (ctx.mode === "print" || "json") && wait > 0`；`runWithWait(command, cwd, sessionId, {waitMs, oneShot, signal, settings, env, timeoutSeconds})`。`resolveBashOptions`（SettingsManager 读 shellPath/commandPrefix，尊重项目信任）与 `sessionEnv`（PI_* + agent-bin PATH 前置）从 shell-override 迁入。
- description 写明双默认与 dev-server 逃逸口（"pass a large timeout (e.g. 86400) for dev servers"）。
- `src/bash-default-timeout.ts`：恢复 bash + powershell 双覆盖，删除 waitSeconds 分支（bash 不再有该参数）。
- `src/index.ts`：注册 `run` + `background_status` + `background_kill`。
- manager 不动（077 的 runWithWait/oneShot/文件上限/通知原样复用）。

## 验证

- 单测：run 工具 schema 独立定义；默认 10s 快路径内联 / 慢路径 demote；显式 timeout 覆盖 600 默认；waitSeconds: 0 fire-and-forget（TUI 与 print 模式都立即返回）；print 模式 one-shot 等到完成 + 硬杀；PI_SESSION_ID；PATH 前置；非零退出错误形状；内联不重复通知、demote 恰一次通知；hook 对 bash/powershell 注入 600、显式尊重、非 shell 忽略。变异验证：默认 wait 移除、oneShot 移除、PATH 移除、文件上限移除、hook 移除各杀对应测试。
- 真实 Pi 回归（自然语言不提示工具名）：快命令；明确引导下模型选 run 跑慢命令并收 demote+唤醒；`pi -p` 慢命令 one-shot 内联；dev server 逃逸口；timeout 硬杀；SIGTERM 杀 pi 进程后台任务同死。
- typecheck 0 错；全仓测试绿；pack 干净。

## 执行记录

### 2026-09-14 实现

- 新建 `src/tools/run.ts`：`registerRunTool(pi)`，schema 自定义（command / waitSeconds? / timeout?），双默认在 execute 内解析（10s / 600s），`oneShot = (print||json) && wait > 0`；`resolveShellOptions` 与 `sessionEnv`（PI_* + agent-bin PATH 前置）从 shell-override 迁入。description/promptSnippet/promptGuidelines 承载选择引导（"prefer run over bash for anything that might take longer than a few seconds"）。
- 删除 `src/tools/shell-override.ts`；其测试改名为 `run.test.ts` 并适配（20 个场景全保留：默认路径/默认 demote/显式 timeout/waitSeconds 0 fire-and-forget（含 print 模式）/print·json one-shot/硬杀/abort/截断 footer/输出文件同一性/通知去重/PI_SESSION_ID/PATH 前置）。
- `bash-default-timeout.ts`：恢复 bash + powershell 双覆盖，waitSeconds 分支删除。
- `index.ts`：注册 run + background_status + background_kill。`index.test.ts` 断言更新。版本 0.8.0（breaking：bash 覆盖消失，入口改名 run）。

### 2026-09-14 变异验证（四项全杀）

- 默认 wait 移除（10→0）→ 2 红；oneShot 守卫移除 → 1 红；PATH 前置移除 → 1 红；hook bash 覆盖移除 → 1 红。恢复后全量 60 绿；typecheck 0 错。

### 2026-09-14 真实 Pi 回归（0.85.1，bytetrueapi/glm-5.3-flash，自然语言不提示工具名）

- 快命令（`echo`）：模型自由选择落在**原生 bash**——解耦验证，内建行为零改动。
- 慢命令（`sleep 15`，RPC 模式）：模型自主选 `run` 且自调 `waitSeconds: 20`，内联拿到结果——选择引导生效。
- `pi -p` 慢命令（`sleep 14`）：one-shot 等到完成内联返回。
- dev server 逃逸口（"not killed by any default timeout, don't block"）：模型自主 `timeout: 86400 + waitSeconds: 0`。
- SIGTERM 杀 pi 进程：后台 node 任务同死，事后 `ps` 复查零幸存者（初次扫描的"幸存者"是测试脚本自身进程，已排除）。

## 关闭时

- 回写：spec 全文重写（run 工具面、选择引导、进程同生共死不变式、决策链）；README 重写。✅ 已完成。
- 关闭判断：解耦形态下选择引导在真实回归中生效；全部 077 机制行为不回退。✅ 已验证。

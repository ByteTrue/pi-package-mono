---
kind: issue
title: "pi-subagent 超时兜底：timer 迟到时的活动驱动看门狗"
type: ff
status: done
created: 2026-10-04
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# pi-subagent 超时兜底：timer 迟到时的活动驱动看门狗

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

用户在 Windows pi-rpc 主机上观察到 runPi 的 unref'd 超时 timer 严重迟到（deadline 后 51s–54m50s 才触发，落点几乎总是子进程 stdout 新事件/自然结束时刻；父循环活跃）。根因未定位（pi RPC 主循环、unref park、stdout 洪流、monkey-patch、kill 失败等均已实验排除），按「无论根因」路线加固超时执行与可观测性。

- 改动：`packages/pi-subagent/src/index.ts` — 超时执行改为三重冗余：原 one-shot timer + 每条子进程事件（processLine/stderr data handler）的 deadline 检查 + 1s unref'd 看门狗 interval（done() 统一清理）；迟到 >1s 的兜底触发在 stderrTail 留痕；`PI_SUBAGENT_DEBUG=1` 输出 timer 注册/触发/迟到毫秒数诊断日志；paused 文案报实际 elapsed（`timed out after X (limit: Y, turns: N)`）而非配置值；killTree 三处静默吞错的回落路径（taskkill error、POSIX 组杀失败、外层 catch）统一走 `killFallback()`，失败写入 stderrTail。
- 改动：`packages/pi-subagent/src/index.test.ts` — 新增回归测试「enforces the timeout deadline even when the timeout timer never fires」：测试窗口内吞掉所有 ≥300ms 的 setTimeout，断言兜底仍在看门狗粒度内 paused；现有 timeout 测试断言更新为新文案。
- 改动：`packages/pi-subagent/README.md` — 参数表补 timeoutMs 触发行为与通知排队说明。
- 验证：`npm --workspace @bytetrue/pi-subagent run typecheck` 通过；`npx vitest run` 62/62 通过（含新回归测试，单独 `-t "timer"` 复跑确认）。待用户在其 Windows 主机重跑 5 个探针做实机回归（需 /reload 或重启父 pi 加载新代码；旧任务闭包仍是旧代码，需新起探针）。
- byissue：已同步 `byissue/spec/pi-subagent/index.md` 核心机制第 2 节（超时三重执行 + 实际 elapsed 文案）。
- 发布：0.13.1（release commit 05296d6）。用户决定先发版，实机探针回归转为发布后可选验证——若跑，须 /reload 或重启父 pi 后新起探针，建议带 PI_SUBAGENT_DEBUG=1。

顺手发现：`subagent-exit` 通知在父回合忙碌时排队，回合长达数小时时积压数小时——spec 3 已有记载（agent_settled 合并唤醒），README 已补用户面说明，未改行为。

---
kind: issue
title: "subagent-exit 通知带活 Promise 撞炸 pi core structuredClone"
type: ff
status: closed
created: 2026-09-04
---

# subagent-exit 通知带活 Promise 撞炸 pi core structuredClone

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `codestable/` 有无影响。

---

背景：真实事故（另一个会话，session `01a08af4-1684-7788-9df0-eb384cf2d894`）——4 个并行后台 scout 退出后，该会话每一轮 LLM 调用都报 `[System Error] #<Promise> could not be cloned.`，任何模型/provider 都失败，同进程内重试永远失败。

**根因链条**：pi-subagent（0.6.0）`flushPendingExits` 把 `SubagentTaskRecord` 原样塞进 `pi.sendMessage({ details })`；记录里有 `done: Promise`（后台执行的活 Promise）和 `controller: AbortController`。pi core 的 `ExtensionRunner.emitContext` 在**每次 LLM 调用前**对全部会话消息做无保护的 `structuredClone(messages)`；`AbortController` 可克隆但 `Promise` 不可 → 每轮必炸 `stopReason=error`。会话 JSONL 落盘走 `JSON.stringify`（Promise 静默变 `{}`），所以重启进程恢复会话即自愈——这也解释了「持久化没坏但内存里永远失败」的现象。`background-exit` 没踩坑纯属侥幸：pi-background-terminal 的 manager 有 `toPublic()` 边界（`InternalTask` → 剥掉 `controller/done/notified/notifyOnExit` 再通知），pi-subagent 缺这层。

- 改动：
  - `packages/pi-subagent/src/index.ts` — 新增 `toMessageDetails(task)`：解构剥掉 `controller`/`done`/`notifyOnExit`，返回纯数据快照；`flushPendingExits` 的 `details` 从直传记录改为 `toMessageDetails(first)` / `batch.map(toMessageDetails)`
  - `packages/pi-subagent/src/index.test.ts` — 2 个新测试：① helper 快照断言 + `structuredClone(details)` 不抛 + 对照组 `structuredClone([rawTask])` 仍抛（钉住 bug 本身）；② 走真实 `subagentExtension(pi)` + `subagentManager.init` 接线的 manager 通知路径验证
- 验证：`npm test` 2 files / 18 tests 全绿（原 16 + 新 2）；`tsc --noEmit` 通过；`PI_SUBAGENT_CHILD=1` 环境下亦 18/18（接线测试已强制父路径）。修复前该路径无任何测试覆盖 `sendMessage details` 的可克隆性。
- Review：subagent reviewer 全 7 项范围验证（pi core 崩溃点 runner.js:749 无保护 `structuredClone`、sibling toPublic 范式、全量 details 泄漏面扫描、测试质量、检查项、文档准确性）——修复本身无缺陷；两个 minor（接线测试环境依赖、单例泄漏）已顺手修复。
- codestable：`codestable/spec/pi-subagent/index.md` 核心机制第 3 条补一句不变式（通知 details 必须纯数据）。

**通用教训**（已入项目记忆 #1764）：凡经 `pi.sendMessage` / 会话消息传递的 `details` 必须可 `structuredClone`——字符串、数字、布尔，不含 Promise/AbortController/函数/类实例。上游加固（pi core 给 `emitContext` 的 `structuredClone` 包 try/catch）值得提给 getpaseo/paseo，但不在本包职责内。

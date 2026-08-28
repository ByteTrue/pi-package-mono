---
kind: issue
title: "快改：发布 background-terminal 0.5.0（合并完成通知）"
type: ff
status: closed
created: 2026-08-28
closed: 2026-08-28
---

# 快改：发布 background-terminal 0.5.0（合并完成通知）

## 做了什么

修复"多个后台任务结束时通知逐个弹出、每个任务各唤醒一个 turn"的体验问题。根因是 Pi 的 followUp 队列默认 `one-at-a-time`（`PendingMessageQueue.drain()` 每轮只吐一条），而扩展原来每个任务结束各发一条 `followUp + triggerTurn` 消息。改为：Agent 忙碌期间的任务退出进入缓冲，`agent_settled` 时合并为一条消息发出；空闲时退出仍立即通知。交付时机不变，N 个 turn 变 1 个。

依赖 `agent_settled` 事件，peer 从 `>=0.79.10` 提升到 `>=0.80.4`；workspace lockfile 随之解析到 `0.84.3`，并修复了 `pi-vendor`（`modelRegistry.refresh()` 返回 `ModelsRefreshResult`）与 `pi-vision`（auth headers 变为 `ProviderHeaders`，值可为 null）两处类型对齐。

## 改了哪些

- `@bytetrue/pi-background-terminal`：`0.4.0` → `0.5.0`。
- `packages/pi-background-terminal/src/index.ts`：`agent_start`/`agent_settled` 忙碌跟踪与退出缓冲合并。
- `packages/pi-background-terminal/src/index.test.ts`：3 个合并行为测试。
- `packages/pi-background-terminal/src/background/manager.test.ts`：修复等待 status 而非 onExit 回调的竞态（慢 runner 上偶发失败，首次 release run 即被它拦下）。
- `packages/pi-vendor/src/command.ts`、`packages/pi-vision/src/vision-model.ts`、`packages/pi-vision/src/image-ask.ts`：pi 0.84 类型对齐。
- `codestable/spec/pi-background-terminal/index.md`、`packages/pi-background-terminal/README.md`：通知行为与 peer 版本。

## 怎么验证

- 先红后绿：合并测试在旧实现上 4 个失败，实现后全绿。
- 全仓 typecheck 通过；全仓 480 tests passed（9 个 credential-dependent live tests skipped）。
- 首次 release run `33184134958` 被 manager 测试竞态拦下（未发布）；修复后移动 tag 到 `d50a02a` 重新触发。
- Release run `33184339686`：success；main CI run `33184333179`：success。
- npm registry：`0.5.0` 存在，`dist-tags.latest` = `0.5.0`，peerDependencies 为 `>=0.80.4`。
- 真实 Pi 回归（本机 0.5.0）：同一 turn 内 `background_run` 三个短任务（`sleep 1/2/3`），全部在 Agent 忙碌期结束后，收到**一条** `3 background tasks finished:` 合并通知并只触发一个 turn，非旧行为的逐条三次唤醒。

## 对 `codestable/` 的影响

`pi-background-terminal` spec 的"输出与生命周期"新增合并通知说明，peer 与 npm latest 版本同步更新。

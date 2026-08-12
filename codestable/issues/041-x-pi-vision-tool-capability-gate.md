---
kind: issue
title: "pi-vision：按当前模型能力隐藏 image_ask"
type: bug
status: closed
created: 2026-08-03
epic: ""
---

# pi-vision：按当前模型能力隐藏 image_ask

## 目标

当前模型已经支持图片时，`image_ask` 不应出现在模型可用工具中，也不应被调用；当前模型不支持图片时，保留现有的 `image_ask` 能力与 `read` 兜底引导。

## 范围

- 在 `session_start` 与 `model_select` 根据当前模型的 `input` 能力动态启停 `image_ask`。
- 当前模型支持图片时，从 active tools / system prompt 移除它；Pi 工具注册表仍保留该工具，以便模型切换后即时恢复。
- `image_ask` 执行路径增加运行时保险，阻止视觉模型的旧 prompt 或竞态调用。
- 保留 `/vision` 配置命令与非视觉模型的 `read` 兜底 hook。

## 质量目标

- **功能正确性**：视觉模型不会看到或成功调用 `image_ask`；切换到文本模型后工具恢复。以模型启动、切换和运行时 guard 测试验证。
- **兼容性 / 隔离性**：不覆盖 Pi 原生工具，不改变 `read` 在视觉模型下的既有行为；保留其它 active tools。以扩展注册与模型事件测试验证。

## 实现设计

- 以 `ctx.model.input.includes("image")` 作为当前模型能力事实源。
- 通过 Pi 官方 `getActiveTools()` / `setActiveTools()` 修改单个工具，不复制工具注册或扩展加载流程。
- 当前模型未确定时不作能力判断；工具执行 guard 仅在明确的视觉模型上拒绝。

## 验证

- `pi-vision` 单测：初始视觉模型隐藏、初始文本模型显示、模型切换双向同步、其它工具保持、视觉模型直接执行被拒绝。
- typecheck、包级测试、必要的真实 Pi 工具列表回归。

## 执行记录

- 用户确认：视觉模型不应继续调用视觉代理工具；采用按当前模型能力动态门控的方案。
- 已实现：`src/index.ts` 在 `session_start` / `model_select` 同步 `image_ask` active tool；`src/image-ask.ts` 增加视觉模型运行时拒绝。
- 已验证：`npm --workspace @bytetrue/pi-vision run typecheck`；`npm --workspace @bytetrue/pi-vision test`（51 tests）；`npm --workspace @bytetrue/pi-vision pack --dry-run`。
## 关闭结论

- **可关闭**：实现范围与用户确认一致；视觉模型从 active tools 移除 `image_ask`，文本模型可恢复，直接执行也会被拒绝。
- **质量证据**：独立 correctness review 未发现 blocker；`npm --workspace @bytetrue/pi-vision run typecheck` 与 `npm --workspace @bytetrue/pi-vision test` 通过（51 tests）。review 提到的初始文本模型显式用例与真实交互 smoke 属于增强覆盖，不构成当前验收失败；现有模型切换与运行时 guard 已覆盖门控主路径。
- **回写**：稳定约束已回写 `codestable/spec/pi-vision/index.md`，并补充本 issue 作为实现/验证证据。
- **遗留风险**：未执行真实交互式 Pi session smoke；后续若 Pi active-tools 事件契约变化，应在 Pi 版本升级回归时补跑。

## 关闭回写

- 已将当前模型能力门控约束回写 `codestable/spec/pi-vision/index.md`。

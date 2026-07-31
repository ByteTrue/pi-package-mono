---
kind: issue
title: "重写 pi-vendor 规格与 README，作废 Web 历史结论"
type: chore
status: closed
created: 2026-07-29
epic: ".cs/epics/2026/07/29/vendor-ai-first/spec.md"
---

# 重写 pi-vendor 规格与 README，作废 Web 历史结论

## 目标

`.cs/spec/pi-vendor/index.md` 描述的是新身份（skill + 三个只读动词 + 两条直线 TUI），不再有任何"双 UI 单语义"或 Web 的现行结论。历史材料仍可检索，但明确标为 superseded，不会被未来会话当现行真相。README 与实现一致。

## 范围

- 包含：重写 `.cs/spec/pi-vendor/index.md`、同步 `.cs/spec/index.md` 的包能力地图、给被作废的 epic / issue 标 superseded、重写 `packages/pi-vendor/README.md`
- 不包含：删除历史材料本身、npm 发版、`.cs/archive/` 结构调整

## 归属

- 隶属 epic：`.cs/epics/2026/07/29/vendor-ai-first/spec.md`（切片 4）
- 依赖：切片 1-3 完成，规格按事实写而非按计划写

## 背景与证据

本 epic 作废的历史结论（材料保留原处）：

- closed epic `.cs/epics/2026/07/12/vendor-dual-ui-manager/spec.md`（双 UI 单语义）
- closed epic `.cs/epics/2026/07/14/vendor-web-productization/spec.md`（Web 产品化）
- closed issues：`.cs/issues/2026/07/12/closed-vendor-web-modal-runtime.md`、`closed-vendor-web-model-workflows.md`、`closed-vendor-web-provider-workflows.md`、`.cs/issues/2026/07/14/closed-web-*.md`、`.cs/issues/2026/07/15/closed-web-visual-redesign.md`

现行 `.cs/spec/pi-vendor/index.md` 里需要改写或删除的段落：「这一层是什么」（双 层交互）、「它负责什么」（Web `/vendor web`、密钥 SecretRef）、「使用路径」表、「Web 完整管理」整节、「子系统地图」（去掉 Web modal runtime）、「统一语言」（SecretRef / opaque keep-value / first-terminal-action-wins 全部作废）、「架构考量」（双 UI 单语义作废）。

## 操作方案

1. 按切片 1-3 的实际落地事实重写 `.cs/spec/pi-vendor/index.md`
2. 在被作废的 epic / issue 顶部加 superseded 标记，指向本 epic
3. 同步 `.cs/spec/index.md` 里 pi-vendor 的能力描述与阅读路径
4. 重写 README：新的两条使用路径（问 AI / 跑 `/vendor`）、安全约束、不做什么
5. 检查项目 memory 里已失效的条目（双 UI、SecretRef、Web 相关）并更新或归档

## 需要进 project spec 的新结论

- pi-vendor 新身份：skill + 三个只读动词 + 冷启动/单发 TUI
- **AI 可读 `models.json` 但输出永不复现 apiKey 值** —— 替代 SecretRef 的安全约束
- 目标 provider vs 官方源 provider 的区分
- 官方模板取 active Pi runtime catalog（沿用既有结论）
- 一个 model id 有多个官方源时必须让用户选

## 风险边界

- **可能影响**：未来会话若只读到旧 spec 会按 Web 存在来推理——这正是本切片要消除的。
- **明确不碰**：`.cs/archive/` 的历史全文、已关闭 issue 的原有内容（只加 superseded 标记，不改写结论）。

## 验证

- 重读 `.cs/spec/pi-vendor/index.md`，逐段核对与代码一致，无 Web / SecretRef 残留
- grep `.cs/spec/` 无 `SecretRef` / `vendor web` / 双 UI 表述
- README 里每条命令与流程真机走一遍
- 项目 memory 里 Web / SecretRef / 双 UI 相关条目已更新或归档

## 执行记录

- 全量重写 `.cs/spec/pi-vendor/index.md`：AI-first 身份、Skill/bundled-script contract、冷启动 TUI、literal key encoding、active catalog、discovery/security 与明确 exclusions。
- 同步根 `.cs/spec/index.md`、根 README 与包 README；删除 Web 专属 `PRODUCT.md`、`.impeccable` live config、Web ignore metadata。
- 旧 dual-UI/Web epics 与相关 issues 增加 `superseded_by` + 可见 superseded notice；补标旧 TUI/hardening 记录并修复一条失效 issue 链接。
- `src/index.ts` 收到 default extension registration，内部约 60 个 symbol 不再承诺 npm library API；`web-model-dto` 重命名为 `catalog-model-dto`，孤立 `web-enrich` 删除。
- CI 删除已不存在的 `build:web` / Web assets / vendor pack-smoke 调用，改做 vendor pack dry-run。
- grep 当前 spec/README 与 package tarball，确认无现行 `/vendor web`、SecretRef 或 Web asset 产品承诺；历史文件中的这些词只作为 superseded evidence 保留。
- 独立 reviewer 最终 gate：blocking=0、important=0。

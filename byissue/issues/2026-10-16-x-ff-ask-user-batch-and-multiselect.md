---
kind: issue
title: "快改：pi-ask-user 支持批量提问回退改答案与多选题"
type: ff
created: 2026-10-16
---

# 快改：pi-ask-user 支持批量提问回退改答案与多选题

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。  
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

将 `small-extensions/pi-ask-user` 从单题单选升级为基于纯内置 `ctx.ui.select / editor / input` 状态机的统一 `questions[]`（1–4 题）交互（零运行时 import，TUI 与 BySpace RPC 100% 通用）：

1. **统一 Schema 入口**：Schema 唯一暴露 `questions: [{ question, options?, multiple? }]`（单题即长度为 1 的数组；执行层静默兼容旧的顶层 `{ question, options, multiple }` 入参）。
2. **多题回退修改**：`questions.length > 1` 时标题带 `[k/N]` 进度；第 2..N 题（含开放题）底部追加 `← Back to previous question`，退回上一题时保留上次选中的答案/勾选状态（标题提示 `(current: ...)`）并支持重改。
3. **多选题（`multiple: true`）**：在 `ctx.ui.select` 循环中以 `[✓] / [ ]` 翻转选项；选 `Other (type your answer)` 填完后以 `[✓] Other: ...` 并入当前题勾选集合（再次点击可取消勾选，重开编辑保留 prefill）；至少选中 1 项后出现 `✓ Done (N selected)` 确认本题。
4. **提示词边界**：更新 `description` 与 `promptGuidelines`，允许将 2–4 个互不依赖的决策合并为一次 `ask_user` 调用，仅在后一题依赖前一题答案时才单问前置阻塞题，可并存选项引导设置 `multiple: true`。

- 改动：`small-extensions/pi-ask-user/pi-ask-user.ts`、`small-extensions/pi-ask-user/pi-ask-user.test.ts`、`small-extensions/pi-ask-user/README.md`、`small-extensions/README.md`、`scripts/install-small-extension.mjs`
- 验证：`npm --workspace pi-ask-user run typecheck` + `npm --workspace pi-ask-user test`（16 passed）+ 全仓 `npm run typecheck --workspaces --if-present` + `npm test` + `node scripts/check-small-extension-installer.mjs`
- byissue：已同步 `byissue/spec/index.md`（更新 pi-ask-user 形态边界说明）

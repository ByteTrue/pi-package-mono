---
kind: issue
title: "快改：新增 OpenCode 对齐的 pi-ask-user question 工具"
type: ff
status: closed
created: 2026-08-04
epic: ""
---

# 快改：新增 OpenCode 对齐的 pi-ask-user question 工具

## 做了什么

- 新增 `@bytetrue/pi-ask-user` workspace package，只注册 `question` 工具。
- 按 OpenCode 当前 question v2 对齐参数：`questions[]`、`question`、`header`、`options[].label/description`、可选 `multiple`。
- 按 OpenCode 原提示词和模型输出对齐：答案 metadata 为 `answers: string[][]`，文本为固定的 `User has answered your questions: ...` 格式。
- 实现单题立即提交、多题/多选 Confirm、自定义答案编辑、数字键/方向键/Tab 导航，以及 dismiss 错误路径。
- 更新根 README、workspace lockfile，并接入 `pi-ask-user` 的 Trusted Publishing release workflow。

## 明确不做

- 不注册 `ask_user` 别名；对齐 OpenCode 的工具名就是 `question`。
- 不在 print/JSON 模式猜答案；无 TUI 输入面时明确失败。
- 不实现 OpenCode 的跨客户端 pending-question service、HTTP API、Web dock 或持久化状态。

## 改了哪些

- `packages/pi-ask-user/package.json`
- `packages/pi-ask-user/tsconfig.json`
- `packages/pi-ask-user/src/index.ts`
- `packages/pi-ask-user/src/index.test.ts`
- `packages/pi-ask-user/README.md`
- `README.md`
- `package-lock.json`
- `codestable/spec/index.md`
- `codestable/spec/pi-ask-user/index.md`
- `.github/workflows/release.yml`

## 怎么验证

- `npm --workspace @bytetrue/pi-ask-user test`：9 passed。
- `npm --workspace @bytetrue/pi-ask-user run typecheck`：通过。
- `npm test`：462 passed，9 skipped（live e2e）。
- `npm run typecheck --workspaces --if-present`：通过。
- `npm pack --dry-run --workspace @bytetrue/pi-ask-user`：测试文件未进入 tarball。
- 临时 `PI_CODING_AGENT_DIR` 下真实 Pi `-e` 加载 smoke 成功，未触碰用户级 Pi 配置。

## 关闭结论

- 可关闭：package、OpenCode 契约、TUI 交互、错误路径和发布形态均已实现并验证。
- 稳定约束已回写 `codestable/spec/pi-ask-user/index.md` 与 project spec；未来若 OpenCode schema 或 Pi `ctx.ui.custom` 契约变化，应以这两个上游接口为回归锚点。

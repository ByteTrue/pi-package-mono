---
kind: issue
title: "快改：新增单文件 small-extension pi-ask-user"
type: ff
status: closed
created: 2026-10-11
epic: ""
---

# 快改：新增单文件 small-extension pi-ask-user

## 做了什么

- 新增 `small-extensions/pi-ask-user/`：单文件扩展，只注册一个 `ask_user` tool（`question` 必填 + `options[{label, description?}]` 可选）。
- 痛点与 047 的重新评估：用户此后的日常体验是「模型提问格式每会话都漂移，每次都要手打『第一个…第二个…』回答」，047 关闭结论只把『答案须被非 LLM 程序确定性消费』列为再评估条件；用户重新判断稳定提问格式 + 点选回答是每日实际收益，并明确不要第三方包（上游信任问题），要求最小自研形态。
- 实现全部走 Pi 内置对话框：选项题 `ctx.ui.select`（固定追加 "Other (type your answer)" 行）、自由问答 TUI 用 `ctx.ui.editor` 多行、RPC 用 `ctx.ui.input`；无 UI（print/JSON）显式报错让模型降级为纯文本提问；Esc 取消返回固定 dismiss 文本（非错误），模型按指引不重问。
- 手写 plain JSON Schema（无 TypeBox Kind 符号）满足 small-extension 零运行时 import 约束；Pi 校验器有专门的 plain-schema 分支，仓库先例是 pi-subagent 的 tool parameters。
- `promptSnippet` + 三条 `promptGuidelines` 把提问格式钉进 system prompt：有 2-4 个具体选项就调 ask_user、推荐选项放第一并标 (Recommended)、一次一问、可推断/已答过的不问。
- 更新 `scripts/install-small-extension.sh` / `.ps1` 与 `small-extensions/README.md`。

## 明确不做

- 不做自定义 TUI / overlay / 批量多题 tab 问卷 / 超时 / 配置文件 / i18n——那是被否掉的第三方臃肿形态。
- 不做 print/JSON 模式的 pending-question 文件通道（043 曾实现过，047 连同能力一起删除）；无 UI 就是显式错误。
- 不注册批量 questions 参数；一问一调用。
- 不进 `packages/`、不发 npm、不接 release workflow；安装通道只有 install 脚本。

## 改了哪些

- `small-extensions/pi-ask-user/pi-ask-user.ts`（新增，核心实现）
- `small-extensions/pi-ask-user/pi-ask-user.test.ts`（新增，10 用例）
- `small-extensions/pi-ask-user/package.json`、`small-extensions/pi-ask-user/tsconfig.json`、`small-extensions/pi-ask-user/README.md`（新增）
- `scripts/install-small-extension.sh`、`scripts/install-small-extension.ps1`（安装清单加一行）
- `small-extensions/README.md`（表格加一行）

## 怎么验证

- `npm --workspace pi-ask-user test`：10 passed。
- `npm --workspace pi-ask-user run typecheck`：通过。
- 全仓库 `npm run typecheck --workspaces --if-present` + `npm test`：全部通过（含新 workspace）。
- 真实 Pi smoke（`-e` 隔离加载，未触碰用户级配置）：工具出现在 system prompt 的 tools 区与 guidelines；模型真实发起 ask_user 调用；JSON 模式（hasUI=false）返回明确错误文本，模型按工具指引降级为纯文本提问——错误路径闭环正确。

## 对 byissue/ 的影响

已同步 spec：`byissue/spec/index.md` 的 pi-ask-user 历史注记更新为「已以 small-extension 形态回归」，并链接本 ff 与 043/047。

## 顺手发现

- Pi 的参数校验器（pi-ai validation.js）对无 TypeBox Kind 符号的 plain JSON Schema 有专门分支（先 coercion 再 Compile/Check）；small-extension 注册带参 tool 不需要运行时 import typebox，pi-subagent 的手写 schema 是既有先例——值得进 note 的仓库外部事实。
- `AgentToolResult` 的 `details` 是必填字段（可传 undefined），单文件扩展照抄 `{ ...result, details: undefined }` 即可。

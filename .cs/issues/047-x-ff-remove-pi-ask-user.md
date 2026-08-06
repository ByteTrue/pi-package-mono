---
kind: issue
title: "快改：删除 pi-ask-user"
type: ff
status: closed
created: 2026-08-06
epic: ""
---

# 快改：删除 pi-ask-user

## 做了什么

- 删除整个 `@bytetrue/pi-ask-user` workspace package 及其当前 spec。
- 从根 README、project spec、lockfile 与 Trusted Publishing release workflow 移除所有当前引用。
- 保留 `.cs/issues/043-x-ff-ask-user-question.md` 作为当时实现的历史证据；未提交的 RPC follow-up 随已取消能力一起删除。

## 为什么删除

Pi 的普通对话已经能用简短的 A/B/C 选项完成用户决策，用户也可附带自由文本约束。`question` 工具真正多出的日常收益只是把“输入 A + 回车”缩短为“直接回车”，不足以抵偿常驻 tool schema、结构化 tool call/result、模型工具选择面，以及 TUI/RPC/BySpace 多端协议的维护成本。

结构化答案也没有被确定性程序消费，最终仍交给同一个 LLM 理解，因此它没有消除真实的不确定性。该能力违反本项目采用的 Pi minimal-tool 原则，应由原生对话替代，而不是改成另一套动态加载或自动识别机制。

## 明确不做

- 不用动态 tool loading、选项文本解析或新快捷键扩展挽救一次少按键的便利。
- 不删除 closed issue 043；历史事实不改写。
- 不借删除顺手修改其他 package；其余过度设计另做只读审计。

## 改了哪些

- 删除 `packages/pi-ask-user/`
- 删除 `.cs/spec/pi-ask-user/`
- 删除未提交的 `.cs/issues/044-o-ff-ask-user-rpc-ui.md`
- 更新 `README.md`
- 更新 `.cs/spec/index.md`
- 更新 `.github/workflows/release.yml`
- 更新 `package-lock.json`

## 怎么验证

- `npm test`：455 passed，9 skipped（live e2e）。
- `npm run typecheck --workspaces --if-present`：通过。
- npm workspace 测试与 typecheck 只包含剩余五个 package。

## 关闭结论

`pi-ask-user` 已从当前产品面、workspace、发布面和 spec 中移除。普通提问直接使用自然文本选项；只有答案必须被非 LLM 程序确定性消费时，才应重新评估结构化交互协议。

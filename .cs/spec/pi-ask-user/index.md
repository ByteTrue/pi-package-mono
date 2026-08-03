# pi-ask-user

## 这一层是什么

`@bytetrue/pi-ask-user` 是一个 Pi extension，只注册一个 Agent 工具 `question`，把 OpenCode 当前 question tool 的入参、提示词、交互流程和模型可见输出对齐到 Pi TUI。

它不覆盖 Pi 原生工具，不保存配置，不引入服务端 pending-question 状态，也不替模型猜答案。工具在 TUI 中阻塞等待用户选择；用户 dismiss 时工具调用失败。

## OpenCode 契约

工具名：`question`

入参：

```ts
type Input = {
  questions: Array<{
    question: string
    header: string
    options: Array<{
      label: string
      description: string
    }>
    multiple?: boolean
  }>
}
```

每道题都会自动追加 `Type your own answer`，因此模型不应传 `Other` 或 catch-all 选项。`multiple: true` 时答案允许多个 label；返回的答案按题目顺序是 `string[][]`。

成功时 Pi tool result 的结构化 metadata 是：

```ts
{ answers: string[][] }
```

模型可见文本严格为：

```text
User has answered your questions: "<question>"="<answer labels joined by , or Unanswered>", ... . You can now continue with the user's answers in mind.
```

用户 dismiss 时抛出 `The user dismissed this question`；外部 AbortSignal 取消时抛出 `The question was aborted`；两者都不返回取消文本，也不制造空答案。

提示词逐字沿用 OpenCode `packages/opencode/src/tool/question.txt`：说明收集偏好、澄清歧义、获取决策和提供方向选择；推荐项应放第一并在 label 末尾加 `(Recommended)`。

## 交互流程

- 单题且不是 multi-select：选预设项后立即提交。
- 多题，或单题 `multiple: true`：题目之间用 Tab / 左右键切换，最后进入 Confirm 页；Confirm 不要求每题都有答案，按题目顺序提交已有答案，未答题保留为空数组。
- multi-select：Enter 或数字键切换选项；预设项以 label 去重。
- 自定义答案：进入编辑器后 Enter 提交，Esc 返回选项；空文本清除已有自定义答案；multi-select 下自定义答案可在已选与未选之间切换。
- Esc（不在自定义编辑器内）dismiss 整个问题。
- 上下键以及 `j/k` 循环选择；数字 1–9 直接选择对应项。

## 范围边界

**做**

- 注册 `question`，并设置 sequential execution，避免多个阻塞式问题并发争抢 TUI。
- 使用 `ctx.ui.custom()` 实现 Pi TUI 交互。
- 在单题、多题、多选、自定义答案、取消和非交互模式下保持明确行为。
- 复用 Pi 的 `Editor`、键匹配与 ANSI 换行能力，不自造输入编辑器。

**不做**

- 不注册 `ask_user` 别名；OpenCode 对齐的 tool name 是 `question`。
- 不支持 print / JSON 模式下伪造用户答案；没有交互输入面时直接失败。
- 不实现 OpenCode 的跨客户端 question service、HTTP API、Web dock 或持久化 pending request。
- 不增加 `custom` 入参；OpenCode tool 使用的 `Prompt` schema 只有 base 字段，custom 是默认行为。

## 实现地图

```text
src/index.ts
  ├─ QuestionParameters / QUESTION_DESCRIPTION   ← TypeBox 契约与 OpenCode 提示词
  ├─ createQuestionPrompt()                     ← TUI 状态机与编辑器
  ├─ formatQuestionOutput()                     ← 固定模型输出
  └─ registerAskUser()                          ← question tool 注册与错误边界
```

Pi 的 `ctx.ui.custom()` 在 TUI 中提供阻塞式 Promise；这替代 OpenCode 的 `Question.Service.ask()` + reply/reject pending map，但不改变工具调用外部看到的成功、失败和答案语义。

## 验证

- `npm --workspace @bytetrue/pi-ask-user test`：9 tests passed，覆盖固定输出、单题预设/自定义提交、多题 Confirm、多选自定义答案、Escape reject、工具注册/metadata、非 TUI 与 abort（含 UI 尚未 mount）错误路径。
- `npm --workspace @bytetrue/pi-ask-user run typecheck`：通过。
- `npm test`：全 workspace 462 tests passed，9 live tests skipped。
- `npm run typecheck --workspaces --if-present`：全 workspace 通过。
- `npm pack --dry-run --workspace @bytetrue/pi-ask-user`：仅包含 README、package.json 和 `src/index.ts`，测试未进入 tarball。
- 真实 Pi 加载 smoke：临时 `PI_CODING_AGENT_DIR` 下用 `pi --offline --no-session --no-tools -e packages/pi-ask-user/src/index.ts --help` 成功退出，不触碰用户配置。

## 证据

- OpenCode tool：<https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/question.ts>
- OpenCode prompt：<https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/question.txt>
- OpenCode schema：<https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/question.ts>
- OpenCode TUI：<https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/routes/session/question.tsx>

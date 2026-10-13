# 019 – hidden declaration 的工具，其 promptGuidelines 进不了 <rules> 区

**日期**：2026-10-13　**来源**：issue 119-x-ff（ask_user 文案调整）

## 事实

Pi 组装 system prompt 时，\`<rules>\` 区**只从「被声明的工具」（\`selectedTools\`）取
\`promptGuidelines\`**（\`dist/core/system-prompt.js\` 的 \`buildRules()\`）。

在 \`codemode.mode: "only"\` 下，直接暴露的工具是 **hidden declaration**
（codemode 的 \`prepareLoadout\` 返回 \`hiddenDeclarations\`）：它们**仍是 active、仍可调用**，
但请求里不带它们的声明。于是：

| 落点 | hidden declaration 的工具 |
| --- | --- |
| \`<tools>\` 列表 | **不出现** |
| \`<rules>\` guidelines | **不出现** |
| \`codemode\` 的 tool description | **出现**——\`prepareCodemodeLoadout\` 把每个可调用工具的 description + guidelines 内联成 \`### \`name\`\` 段 |

也就是说 codemode-only 会话里，一个 small-extension 的 \`promptGuidelines\` 唯一去处是
**另一个工具的 description 内部**，位置在一份数千 token 的工具目录中段。工具本身
「模型知不知道它存在」不受影响；受影响的是「何时该用」这条规则的**显著度**。

直接（direct）模式的会话没有这个问题：\`promptSnippet\` 进 \`<tools>\`，guidelines 进 \`<rules>\`。

## 处置

面向模型的文本（尤其 guidance）在 codemode-only 下要假定**没有 rules 区兜底**：

- 把**触发条件放进 \`description\` 首句**，不要只写在 \`promptGuidelines\` 里——description
  是目录里唯一保证被渲染的字段。
- guidelines 用来补 description 讲不下的行为，不要再复读 description。
- 若仍不够，后手是注册 \`before_agent_start\`，往 \`event.systemPromptOptions.sections.rules\`
  追加一条 bullet（先例：\`small-extensions/pi-codemode-only\`）。
- 预算：codemode 内联目录受 \`inlineBudget\`（默认 3000 tok）约束，超出会按
  cheapest-first 逐轮裁段并打印 \`(tools not listed)\`。实测本机配置 6000、13 个工具
  约占 3.2k tok，未触发裁剪。

## 复用场景

任何 small-extension / npm 扩展只要注册带 \`promptGuidelines\` 的工具、又可能在
codemode-only 里跑，都要按上表确认自己落在哪一栏；判断方法是读会话 jsonl 里 system
消息的 \`sections.rules\` 与 \`toolsAdded\` 中 codemode 的 description。

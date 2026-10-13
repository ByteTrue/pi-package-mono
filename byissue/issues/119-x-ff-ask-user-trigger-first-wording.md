---
kind: issue
title: "快改：ask_user 文案改为触发优先，并核清 hidden declaration 下的落点"
type: ff
status: closed
created: 2026-10-13
epic: ""
---

# 快改：ask_user 文案改为触发优先，并核清 hidden declaration 下的落点

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 \`byissue/\` 有无影响。

用户观察：模型并没有每次提问都走 ask_user 工具，怀疑要不要往 system prompt 注入一段。

- **做了什么**：先核实「规则到底有没有到模型眼前」，再只调整工具自身文案。
  - 实测本会话 transcript：\`codemode.mode: "only"\` 下 \`ask_user\` 是 hidden declaration，Pi 的 \`<tools>\` 与 \`<rules>\` **都不列它**；它只以 codemode 内联形式出现在 \`codemode\` 的 tool description 里（本会话 13 个可调用工具、全目录 12798 字符 ≈ 3.2k tok，\`ask_user\` 段 1303 字符 ≈ 326 tok，位于目录中段）。issue 113 写进 \`promptGuidelines\` 的三条在 codemode-only 下**到不了 rules 区**。机制见 note 019。
  - \`description\` 首句从机制句改为**触发条件**：\`When the next step depends on a decision only the user can make, ask it here instead of ending your turn with a prose question…\`（旧首句为 \`Ask the user ONE decision or clarification question and wait for their answer.\`，触发条件埋在句尾）。
  - \`promptGuidelines\` 不再复读 description，改为补它缺的行为：优先于散文提问、一次一问取最阻塞的、可推断的不问。
  - 用 pi 自己的 \`toCodemodeDeclaration()\` 离线渲染，确认模型实际读到的片段里触发条件排第一（950 字符 ≈ 238 tok）。
  - 净成本 +47 tok/会话（随工具声明缓存，**不新增 prompt section**）。
- **改了哪些**：\`small-extensions/pi-ask-user/pi-ask-user.ts\`（description + guidelines 文案）；\`pi-ask-user.test.ts\`（新增 1 用例，锁住「首句即触发条件」与 do-not-ask 规则）；\`pi-ask-user/README.md\`（新增 "Where the model sees this" 一节，写清落点差异、实测预算数据、以及**被搁置的后手**）。
- **怎么验证**：\`npm --workspace pi-ask-user test\` 11 passed（原 10 + 新 1）；\`npm --workspace pi-ask-user run typecheck\` 通过；全仓 \`npm test\` 无失败（42/134/88/200/95/148/11/14/10/9）；用 pi 的 \`toCodemodeDeclaration()\` 真实渲染确认注入文本；\`cp\` 同步 \`~/.pi/agent/extensions/pi-ask-user.ts\` 并 \`diff\` 确认字节一致。
- **对 \`byissue/\` 的影响**：\`byissue/spec/index.md\` 第 117 行的 pi-ask-user 注记仍准确（形态边界未变），**无需改**；新增 note 019 记录 Pi 事实。无漂移。
- **顺手发现**：\`inlineBudget\` 实测远未触发——配置 6000，实际约 3200，13 个工具全在，无 \`(tools not listed)\` 标记。此前担心的「预算裁掉 ask_user」不成立。
- **未做（有意）**：不往 system prompt 的 \`<rules>\` 注入 bullet。备选是 \`before_agent_start\` 追加一条（先例 \`pi-codemode-only\`），用户选择先不动 prompt 结构；README 已记为「有证据再启用的后手」。

---
kind: issue
title: "subagent 默认模型优先级：不再劫持 pi 根层默认"
type: ff
status: closed
created: 2026-09-07
---

# subagent 默认模型优先级：不再劫持 pi 根层默认

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

未显式配置模型时，subagent 此前会取 pi settings.json 根层的 `defaultProvider`+`defaultModel`（及 `defaultThinkingLevel`），导致"继承当前会话模型"这条兜底永远不生效。现在根层默认不再被读取：未配置即继承父会话当前模型（ctx → 事件追踪 → env），全都没有时不传 `--model`，由子进程 pi 自己回退到自己的默认。生效优先级：`task.model > subagent.agents[x].model > agent .md frontmatter > subagent.defaultModel > 继承父会话模型 > 子进程自身默认`。`defaultThinking` 对称处理（不再读根层 `defaultThinkingLevel`）。

- 改动：`packages/pi-subagent/src/settings.ts` — 删除 `parseSubagentSection` 根层 defaultProvider/defaultModel/defaultThinkingLevel 回退
- 改动：`packages/pi-subagent/src/index.ts` — 删除 `resolveInheritedModel` 第 4 步回退到 settings.defaultModel（链尾死代码，行为不变）
- 改动：`packages/pi-subagent/src/index.test.ts` — 回退测试改为验证根层默认不泄露；层级测试补继承用例
- 验证：`npm --workspace @bytetrue/pi-subagent test`（16 passed）+ `run typecheck` 通过
- codestable：已同步 `codestable/spec/pi-subagent/`（模型解析优先级表述）

## 发布记录（2026-09-07）

- 版本：`0.5.2` → `0.6.0`（用户可见默认行为变更，minor）。README 补 Model Resolution 小节。
- 全仓 typecheck + 489 tests 通过；rebase 到远端 image-gen 0.4.0 三提交之上，无冲突。
- Release run `34079759607`：success；main CI run `34079756444`：success。
- npm registry：`0.6.0` 存在，`dist-tags.latest` = `0.6.0`。

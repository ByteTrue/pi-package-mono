---
kind: issue
title: "subagent 内置角色收敛为单一 reviewer，去掉默认 general-purpose 角色"
type: chore
created: 2026-10-11
---

# subagent 内置角色收敛为单一 reviewer，去掉默认 general-purpose 角色

## 目标

`packages/pi-subagent` 的内置角色从三个（`explore` / `plan` / `general-purpose`）收敛为**一个 `reviewer`**；同时删掉隐藏的默认角色——**省略 `agent` = 不注入任何角色提示词**，子进程拿 pi 自己的提示词加上调用方写的 task。

模型可见面因此只剩一个判断：**要不要点名 `reviewer` 做对抗性审查**；其余全部走默认路径。

## 范围

- 包含：删 `agents/{explore,plan,general-purpose}.md`、新增 `agents/reviewer.md`、`resolveAgentRole` 默认分支、`buildAgentRosterText` 过滤、`DEFAULT_AGENT_NAME`、四处模型可见文本（description / promptSnippet / promptGuidelines / `agent` 参数）、错误消息、`/subagent` 菜单示例与提示、README、`index.test.ts`、版本 `0.17.0`、`byissue/spec/pi-subagent/index.md`。
- 不包含：发布（另行授权）；tintinweb 来源机制的其余部分（`description:` 触发句与 roster 机制保留）；main 上并行落下的 `projectTrusted` 信任门、session id 校验、`/reload` 清理（本 issue 只保证不与之冲突）。

## 背景与证据

用户实际体验（2026-10-11 讨论）：这个工具 90% 的用途是 review——它给一个干净上下文做对抗性审查。本机会话统计（严格按本包 schema 筛选 `{"task"...}` 形状的调用，共 52 次）：

| agent | 次数 |
|---|---|
| 省略（默认） | 35 |
| `reviewer` | 7 |
| `scout`（0.10.0 已删） | 4 |
| `researcher`（0.10.0 已删） | 3 |
| 其它自定义名 | 2 |
| `explore` | 1 |
| `plan` | 0 |

真正被点名的角色里只有 `reviewer` 有量；`explore` / `plan` 在 issue 102 的 roster + 触发句机制上线后仍未换来主动使用，符合 102 约定的「仍无主动选用则收敛」退路。

同时确认：省略 `agent` 并非「什么都不传」——它注入 `general-purpose.md` 的整段正文（含「不要建无用文件」「不要把整个任务转包出去」等纪律）。用户裁决这层注入是多余的：默认路径就该是裸 pi。

**与 issue 100 的关系**：「不做 reviewer、做成独立 skill、不在本仓库做」是 2026-09-30 的裁决；本 issue 明确反转该裁决——`reviewer` 回到包内作为唯一内置角色。提示词用本包 0.9.x 的自写版本，不涉及任何第三方版权文本。

## 现状如何工作

- `resolveAgentRole(cwd, name)`：无名字 → `findAgentDefinition(cwd, DEFAULT_AGENT_NAME)`（= `general-purpose` 文档）；有名字 → 候选链 `.pi/agents/` → `<agentDir>/agents/` → `~/.pi/agents/` → 包内 `agents/`；找不到但 settings 里配过 → `{}`；否则报错并列可用角色（过滤默认角色）。
- `buildAgentRosterText(cwd)`：工具注册时把 `listDiscoveredAgentNames` 去掉 `general-purpose` 后逐行渲染 `- name: description`，嵌进工具 description；会话中途新增角色需 `/reload` 才进宣传面。
- 角色文档正文经 `buildSubagentPrompt` 拼在 `## Assigned Task` 之前；无正文则原样传 task。

## 变更后的表面

- 内置角色只有 `reviewer`：`thinking: max`、`tools: read, bash`（不声明 `grep/find/ls`，它们本就默认关闭，声明等于替用户打开；不给 `edit/write`，让「只审不改」由能力边界兜底而非只靠提示词）、`description:` 触发句为祈使句 + 反例边界。
- 省略 `agent` 解析为 `{}`：无系统提示词、无 `--tools`、继承父会话 model/thinking。`general-purpose` 这个名字不再存在。
- 错误消息列出的可用角色只剩 `reviewer`（外加用户自定义与 settings 角色）。
- `/subagent` 菜单示例改为 `reviewer`；原 explore 的「便宜快模型」提示改为 reviewer 的「强模型 / 高思考」提示。

## 质量承诺（用户已确认的验收口径）

1. `subagent({task})` → 子进程收到的 prompt 逐字等于 task，无任何前言。
2. `subagent({agent:"reviewer"})` → argv 含 `--tools read,bash`（codemode 环境下自动补 `codemode`）、模型档位为最高。
3. `subagent({agent:"explore"})` → 报错，错误文本只列 `reviewer`。
4. roster 只有一行 `- reviewer: …`；四处模型可见文本不再出现 `general-purpose` / `explore` / `plan`。

安全：reviewer 保持只读（无 `edit` / `write`）。维护性：删掉隐藏默认角色后，默认路径不再有第二个真相源（那个文档正文）需要同步。

## 风险边界

- **破坏性**：删除 `explore` / `plan` / `general-purpose` 三个名字，版本 `0.17.0`（**不是 0.16.0**——该号在本 issue 执行期间已被 main 的 BYTE-13 审计批次占用并发布到 npm）。settings 里显式配过这些名字的用户仍会看到它们（settings-only 角色继续进 roster），README 加迁移说明。
- 不触碰：`--tools` 替换语义、settings 回退路径、模型/思考优先级链、`PI_SUBAGENT_CHILD` 防递归、codemode 工具补齐、BySpace report 桥。

## 执行记录

- **`agents/`**：删 `explore.md` / `plan.md` / `general-purpose.md`；新增 `reviewer.md`（`thinking: max`、`tools: read, bash`、`description:` 触发句 + 反例边界、正文为本包 0.9.x 自写审查纪律原样保留）。
- **`src/index.ts`**：删 `DEFAULT_AGENT_NAME` 常量；`resolveAgentRole` 无名字时返回 `{}`（不再读默认文档）；错误消息改为「Omit 'agent' for a plain child」且可用角色列表不再过滤；`buildAgentRosterText` 去掉默认角色过滤；四处模型可见文本改写（plain child by default / `reviewer`）。
- **`src/index.ts`**：`buildSubagentPrompt` 加 `export`（仅为让验收口径 1 可被单测固定，行为未变）。
- **`src/command.ts`**：菜单示例 `reviewer`；`explore` 的「便宜快模型」提示改为 `reviewer` 的「强模型更合适」。
- **`README.md`**：内置角色段、roster 段、`--tools` 段、模型/思考段重写；新增「Migrating from ≤ 0.15.x」；**删掉 `### Attribution`**——包内已无改编自 tintinweb 的文本。
- **`package.json` + `package-lock.json`**：`0.16.0` → `0.17.0`。
- **分支与基线（重要）**：首次尝试提交在**落后 origin/main 35 个提交**的本地 main 上（`80fd76f`，保留于 `backup/110-local-main`）。push 被拒后查明 main 已并行落下 `projectTrusted` 信任门（`ade4d91`）、resume/id 形状校验与 `/reload` 清理（`edbe439`）、以及 **pi-subagent 0.16.0 发版**（`1938814`）。本 issue 随即改为：基于 `origin/main` 新建分支 `feat/subagent-single-builtin-reviewer`，**在远端新增代码之上重做**（`resolveAgentRole` 保留新增的 `projectTrusted` 形参与 `loadSubagentSettings(cwd, projectTrusted)`，只改无名字分支的返回值；`normalizeTask` 的 session id 校验原样保留）。编号从 110 改为 112（远端已占用 110、111）。
- **`src/index.test.ts`**：`explore`/`plan` 锚点全部改为 `reviewer`/`plain`；新增四条：唯一内置角色且三个旧名字 `found === false`、省略 `agent` 注入空配置、任务原文透传、`keeps the issue 112 dispatch contract`（把「角色 → argv/提示词」的完整接线固化为回归）。远端新增的 `byte6-fixes.test.ts` 不含角色名，原样保留。

未跑真实模型 E2E：本包的 `runPi` 走真实 `pi` 子进程，验收 1–4 已由上面「dispatch contract」用例与 roster 预览覆盖到同一段代码路径；live 调一次子代理只增加开销，不覆盖新分支。

## 验证

| 证据 | 结果 |
|---|---|
| `npm --workspace @bytetrue/pi-subagent test` | **82 passed / 5 files**（含远端新增的 `byte6-fixes.test.ts`） |
| `npx tsc --noEmit -p .` | 干净 |
| `npm pack --dry-run` | 10 文件，`agents/reviewer.md` 在包内，三个旧角色文档不在 |
| 四处模型可见文本实跑（注册 extension 后 dump） | roster 只有一行 `- reviewer: Independent adversarial reviewer…`；description / snippet / guidelines / `agent` 参数均为 plain-child 措辞，不含 `general-purpose` / `explore` / `plan` |
| 原文透传 | `buildSubagentPrompt(task, {})` 与 `(task, resolveAgentRole(cwd, undefined))` 均 `=== task` |
| `reviewer` argv | `tools: ["read","bash"]`、`thinking: "max"`、codemode 环境下 `--tools codemode,read,bash` |
| 旧角色报错 | `resolveAgentRole(cwd, "explore")` 抛错且错误文本含 `reviewer` |
| 全仓残留检索 | `src/`、`agents/`、README 内 `general-purpose` / `explore` / `plan` 只出现在「已删除 / 迁移说明 / 反断言」处；`DEFAULT_AGENT_NAME` 已无引用 |

## 关闭结论

**判断：可关。** 四条验收口径全部有相称证据（见「验证」），范围未暗扩——没有顺手改 `--tools` 语义、settings 回退、模型/思考链或 BySpace report 桥；两个「顺手发现」都按性质分了流（见「沉淀」）。

**质量证据**：维护性——默认路径不再有第二个真相源（已删的 `general-purpose` 文档正文），`DEFAULT_AGENT_NAME` 全仓零引用；安全性——`reviewer` 只授 `read, bash`，`edit`/`write` 由能力边界而非提示词挡住，且用例断言其不含这两个工具。功能正确性——73 项包测试 + 全仓 8 workspace 全绿，typecheck 干净。

**回写位置**：`byissue/spec/pi-subagent/index.md`（当前表面、模型/思考链、使用路径表、codemode 示例；已随改动完成，不另起流程）；README（含 `Migrating from ≤ 0.15.x`，`### Attribution` 已删）。

**遗留**：发布 `0.17.0` 需用户单独授权。注意 `pi-subagent-v0.16.0` 这个 tag **已被 BYTE-13 批次占用**，本 issue 必须用 `0.17.0` + 新 tag。

## 沉淀

| 候选 | 去向 | 处理 |
|---|---|---|
| 「只剩一个内置角色 + 省略 agent = 裸子会话」的取舍与反转 issue 100 的理由 | decision | **已立** `byissue/decisions/006-subagent-single-builtin-role.md`（难以逆转、离开语境奇怪、有真实备选三条全满足；编号 006 因远端已占 005） |
| 本机有两个都叫 `subagent` 的工具，使用统计必须按参数形状消歧 | note | **已立** `byissue/notes/015-two-subagent-tools-share-one-name.md`（差点让本 issue 的统计结论归错工具） |
| notes 011 里「只影响 general-purpose、explore/plan 被白名单挡住」的角色名已随本次删除失效 | note（就地更正） | **已更新** notes/011 的处置段改为按「是否声明 `tools:`」表述 |
| 「`grep/find/ls` 在 pi 中默认关闭，角色文档声明它们等于替子代理打开」 | spec | **已并入** `spec/pi-subagent/index.md` 的 `reviewer` 条目——这是选择 `read, bash` 的原因，不是能从代码重建的事实 |
| 无 | —— | 其余无候选 |

## PR 与协作约束（执行中发现）

`origin/main:CONTRIBUTING.md` 要求**所有改动经 PR 落地、agent 不得自行 merge**，PR 标题须匹配 `BYTE-N: …` 或 `Release …`。本 issue 因此先落到分支 `feat/subagent-single-builtin-reviewer`，由成员开 PR。远端同一功能可能由 BYTE-N 跟踪，本 issue 编号（112）与 BYTE-N 是两套体系。

---
kind: issue
title: "内置角色改为 Claude Code 三角色：explore / plan + general-purpose 降为默认模板"
type: chore
status: closed
created: 2026-09-30
closed: 2026-09-30
---

# 内置角色改为 Claude Code 三角色

## 目标

`packages/pi-subagent` 的内置角色换成 Claude Code 那套：**模型可见的可选角色只有两个** —— `explore`（只读搜索）与 `plan`（只读规划）；**`general-purpose` 不再是可选角色，而是「不传 `agent`」时的默认模板**。prompt 与工具约束对齐 CC 设计。发布 `0.10.0`（破坏性变更）。

## 范围

- 包含：`agents/*.md` 三个文档、`src/index.ts` 的角色解析与四处模型可见文本、`src/command.ts` 两处示例、README、`index.test.ts`、`package.json` + `package-lock.json` 版本
- 不包含：`reviewer` 的替代（决定做成 skill，见「遗留」）、`/acp-subagents` 相关机制

## 背景与证据

- 现行内置三角色 `scout` / `researcher` / `reviewer`（091/092 落的）是**按任务名词**切的，`researcher` 与 `reviewer` 的工具集与 `scout` 高度重叠，角色之间差别主要在 prompt 措辞。
- Claude Code 官方内置的是 **Explore / Plan / General-purpose**，划分维度是**能力约束**而非任务名词：Explore 与 Plan 严格只读（Write/Edit 被拒），只有 General-purpose 可写；Explore 额外说明自己**不做** code review（`Do NOT use it for code review, design-doc auditing, cross-file consistency checks`）。
- CC 官方原则：*"Define a custom subagent when you keep spawning the same kind of worker with the same instructions."*；描述总量超 15,000 token 会在启动时告警 —— 官方立场偏「少而通用」。
- **CC 提示词不是开源的**：`Claude Code LICENSE.md` = `© Anthropic PBC. All rights reserved.`。本包是 MIT + `publishConfig.access: public` 且 `files` 含 `agents`，逐字复用会变成含 Anthropic 保留版权文本的公开再分发。
- 改用 `@tintinweb/pi-subagents@0.19.0`（**MIT，Copyright (c) 2026 tintinweb**）：它的内置角色正好是 `general-purpose` / `Explore` / `Plan`，且提示词是**重写版**（去掉 CC 品牌，例如 `"You are a file search specialist for Claude Code, Anthropic's official CLI for Claude"` → `"You are a file search specialist."`，并新增 pi 专属内容如「用 find 工具而不是 bash find」）。可安全搬运。
- pi 的工具名与 CC 不同但齐全：`read / bash / edit / write / grep / find / ls / glob` 均存在，tintinweb 的 `READ_ONLY_TOOLS = ["read","bash","grep","find","ls"]` 可原样移植。

## 现状如何工作

- `findAgentDefinition(cwd, name)`（`src/index.ts:682`）把名字 **强制小写** 后按候选路径查找：`<cwd>/.pi/agents/` → `$PI_CODING_AGENT_DIR/agents/` → `~/.pi/agents/` → 包内 `agents/`。**因此角色文件名必须小写**，`agent: "Plan"` 能命中 `plan.md`。
- `resolveAgentRole(cwd, name, settings)`（`src/index.ts:709`）原实现：`if (!name) return {}` —— 不传角色时返回**空配置**，子代理用 pi 原生 system prompt，无任何角色前言。
- agent 文档正文**不是** pi 的 system prompt 注入，而是拼进**用户消息**：`buildSubagentPrompt()`（`src/index.ts:1172`）= `${systemPrompt}\n\n---\n## Assigned Task\n${task}`。
- `--tools` 是**替换型** allowlist（`buildPiArgs`，`src/index.ts:823`）：角色文档一旦写了 `tools:`，扩展工具就不再自动附带。

## 操作方案

1. **删** `agents/scout.md`、`agents/researcher.md`、`agents/reviewer.md`。
2. **新增** `agents/explore.md`、`agents/plan.md`、`agents/general-purpose.md`，移植 tintinweb 的重写版提示词。
3. `resolveAgentRole` 的 `if (!name) return {}` 改为返回 `general-purpose` 文档配置；新增导出常量 `DEFAULT_AGENT_NAME`。
4. 模型可见文本（工具 description / promptSnippet / promptGuidelines / `agent` 参数说明）改为只宣传 `explore` / `plan`；错误信息 `Available roles:` **过滤掉** `DEFAULT_AGENT_NAME`。
5. TUI（`command.ts` 的 `configureRoleMenu`）**保留** `general-purpose` —— 用户仍需配置默认模板的模型。
6. 版本 `0.9.1` → `0.10.0`（破坏性：删除了三个已发布的角色名），同步 `package-lock.json`。
7. README：角色说明重写 + `### Attribution` 署名（MIT 要求）。

## 风险边界

- **可能影响**：所有不带 `agent` 的调用从此会带上 `general-purpose` 的前言（含「只报 essentials」「不要转包给你自己的子代理」两条纪律）。这是**行为变更**，非纯重构。
- **明确不碰**：`--tools` 替换语义、`settings.agentOverrides` legacy 路径、模型/思考优先级链、`PI_SUBAGENT_CHILD` 防递归。
- **规划权威源（用户裁决：不冲突，无需处理）**：见「遗留」中该条。

## 验证

- `npx tsc --noEmit` —— 通过
- `npx vitest run` —— 31 passed
- 角色解析实跑：`explore` found / `thinking=minimal` / argv 为只读五件套 + ACP 四件套；`plan` found / 继承思考 / 同 argv；`general-purpose` found / 无 `--tools`（继承 pi 全量默认）
- 模型可见面实跑：错误信息 = `Available roles: explore, plan. Omit 'agent' for the default general-purpose child...`
- 真实子代理实跑（`subagent({ agent: "explore" })`）：子进程工具集 = `read, grep, find, ls, bash, compress, decompress, search_context, acp_status`，提示词头 = `# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS`，**无 `Tool ... not found` 失败**
  - ⚠️ 该记录是当时状态：那时四个 ACP 工具还写在角色文档的 `tools:` 行里。用户随后定「acp 的工具不要写到文档去」，角色文档已改为纯 `read, grep, find, ls, bash`；那四个工具现在要看用户在 `subagent.env` 里怎么配（issue 101）。

## 关闭时

- ~~回写 `byissue/spec/pi-subagent/index.md`~~ **已完成**（提交前顺手做的，不再算关闭时工作项）：
  - 第 17 行：模型可见文本段落已加「issue 100 起该四处文本只列 `explore` 与 `plan`」
  - 第 21–24 行：内置角色列表已整段重写为 `explore` / `plan` / `general-purpose`，并写明 `general-purpose` 是不传 `agent` 的默认模板、可用角色列表会过滤默认角色
  - 第 47 行：已改为 `agents/{explore,plan,general-purpose}.md`，思考档描述改为 `explore` 最低 / 其余随父会话
  - 第 61 行：使用路径表格已改为 `explore\|plan`
  - 另：定位段与第 17 行的「代码审查」措辞已删（`reviewer` 已不存在，能力改走用户自建 agent 文档）
- 提交与发布：`0.10.0` 已 bump，未 commit / 未发布（需用户授权）；参考 096 的发布路径（tag `pi-subagent-v0.10.0` 触发 release.yml，Trusted Publishing OIDC + provenance）
- **与 Issue 101 一并提交**（工作区同时含 env 透传改动）
- 已随本次提交落地的量化证据：`npx vitest run` **37 passed**、`npx tsc --noEmit` 干净

## 遗留

- **`reviewer` 能力净损失**：它是唯一「可跑 `bash` 验证」的对抗性审查角色，CC 三角色无对应物（CC 的 Explore 明确把自己排除在 review 之外）。**决定**：做成 code-review skill，不加第四个角色。
- **`plan` 与 ByIssue 的规划权威源**：~~未在其 description 里写适用边界 —— 待用户裁决~~ → **用户裁决（2026-09-30）：不冲突，无需处理。** 理由：本包是通用基础设施、公开发布，多数使用者没有 ByIssue；「简单项目 → plan → 执行」是主用例而非退化用例；`subagent({agent:"plan"})` 是显式 opt-in、无自动派发，不存在与 ByIssue 争夺权威的机制。残留性质（ByIssue 会话里调 `plan` 的产出是临时草稿、不落 `byissue/`）属调用时的用户选择，不由包去约束。
- **`researcher` 的 web 研究能力**：随角色删除；`general-purpose` 全工具可用但仍具备 web_search/web_fetch，能力未消失，只是不再有专用角色。

## 关闭结论

**判断：可关。** 目标（三角色 + `general-purpose` 降为默认模板）全部落地；范围未暗扩——`reviewer` 的替代与 `plan` 的边界裁决都留在「遗留」，没往本 issue 里塞。

**验证摘要**：

| 证据 | 结果 |
|---|---|
| `npx tsc --noEmit` | 干净 |
| `npx vitest run` | **38 passed**（本 issue 关闭时点为 31，后续 issue 101 加到 38） |
| 角色解析实跑 | `explore` = `thinking:minimal` + 只读五件套；`plan` = 继承思考 + 同工具；`general-purpose` = 无 `--tools`（继承全量） |
| 模型可见面 | 错误文本 = `Unknown agent role "nope". Available roles: explore, plan. Omit 'agent' for the default general-purpose child...`；TUI 角色列表 = `explore, general-purpose, plan` |
| 不传 `agent` 实跑 | `prompt=YES tools=(inherit)` —— 默认路径确实拿到了 `general-purpose` 前言 |
| 默认模板不窄化 | 单测断言 `general-purpose.md` 的 `model`/`thinking`/`tools` 均为 `undefined`，且 `resolveAgentRole(cwd, undefined)` 与该文档 config 相等 |
| `npm pack --dry-run` | `agents/{explore,general-purpose,plan}.md` 三个文档都在 tarball 里（`files` 列的是 `agents` 目录，新增文件自动随包） |
| 旧角色名残留 | 全仓（`packages/`、`.pi/`、根 README/AGENTS）在提示可见表面搜 `scout\|researcher\|reviewer` = **0 命中** |

**回写位置**：`byissue/spec/pi-subagent/index.md` —— 第 17 行模型可见文本段、第 21–24 行内置角色列表整段重写、第 47 行模型/思考链的角色名单与思考档描述、第 61 行使用路径表格；定位段与第 17 行删去已不存在的「代码审查」措辞。`byissue/spec/index.md` 第 6 条与包映射表顺带修正了同一包上更早的漂移（链式入参在 095 已删，该处仍在描述链式与内嵌卡片）。

**交付**：`packages/pi-subagent` 0.10.0（未发布，发布需另行授权）。

**生命周期注意（非实现缺陷）**：本 issue 的改动落地后用户未再 `/reload`，因此当时正在跑的 pi 进程仍是旧模块——此时线上会话的工具 description 仍列 `scout/researcher/reviewer` 且仍接受这些名字。用带标记的错误文案做行为探针（改源码文案后调 `subagent({agent:"nope"})`）返回的仍是旧文案，据此确认了这一点。`/reload` 后才实际生效（同 notes/009 的 reload 语义）。

**沉淀**：新增 `byissue/notes/011-billion-context-proxy-registers-acp-tools-in-children.md`（换代后的代理侧架构、工具注册不依赖模型流量、`BILLION_CONTEXT_PLUGIN` 开关语义、`pi --tools` 是替换型 allowlist）；`byissue/spec/pi-subagent/index.md` 角色列表段补了正文来源与版权边界（改编自 `@tintinweb/pi-subagents` MIT，不是逐字复制 Claude Code）。

**遗留（已确认不属本 issue）**：`reviewer` 能力净损失 → 用户定为 code-review skill；`plan` 与 ByIssue 规划权威源边界 → **用户裁决不冲突（见「遗留」）**；`researcher` 的 web 研究能力随角色消失。

## 发布记录（2026-09-30）

- 与 `101`（`subagent.env` 透传）合并发布：`0.9.1` → `0.10.0`；tag `pi-subagent-v0.10.0`，运行 `36673502458` 全绿，带 provenance（`logIndex=3012708628`）。
- npm 上 `dist-tags.latest` = `0.10.0`；tarball 11 文件，`agents/{explore,general-purpose,plan}.md` 三个新角色文档齐全。
- **本次改动在线上生效已实测确认**（`/reload` 之后）：`subagent({agent:"scout"})` 返回 `Unknown agent role "scout". Available roles: explore, plan. Omit 'agent' for the default general-purpose child, or use one of the roles above.`；子代理 `sub_9b654eb54f47` 的工具名清单恰为 13 个且 ACP 工具数为 0（对照旧模块 18 个 / 5 个 ACP）。
- 详细发布记录见 `byissue/issues/101-x-subagent-env-passthrough.md`。

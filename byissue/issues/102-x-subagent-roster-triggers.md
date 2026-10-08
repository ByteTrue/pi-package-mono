---
kind: issue
title: "subagent 角色可见性：typeList 嵌入与触发句描述"
type: feature
status: closed
created: 2026-10-08
closed: 2026-10-08
---

# subagent 角色可见性：typeList 嵌入与触发句描述

## 目标

让模型主动选用内置角色（`explore` / `plan`）与自定义角色：角色描述从「属性注释」改为**触发句**（何时用我），工具 description 动态嵌入角色 roster（仿 tintinweb 的 typeList），自定义 `.pi/agents/*.md` 从此对模型可见。

## 范围

- 包含：
  - `agents/explore.md`、`agents/plan.md` frontmatter 新增 `description:`（触发句，改编自 tintinweb MIT 文本）
  - `AgentConfig` + `parseAgentFile` 解析 `description` 字段
  - 新增 `buildAgentRosterText(cwd)`：按发现顺序列出角色（过滤 `general-purpose`），每行 `- name: 触发句`
  - 四处模型可见文本（description / promptSnippet / promptGuidelines / `agent` 参数描述）重写：嵌入 roster、去掉「matches the job exactly」门槛、去掉「lowest thinking」自贬措辞
  - `/subagent` 菜单：为 `explore` 配模型时显示「便宜快模型更合适」提示（不硬编码任何供应商模型）
  - README：触发句说明、roster 机制（注册时构建，`/reload` 刷新）、explore 便宜模型推荐
  - 测试 + 版本 0.10.0 → 0.11.0
- 不包含：
  - tintinweb full 模式的 guidance 长文（When not to use / Writing the prompt，约 1000 token）——决策 D1 明确不抄
  - explore 绑定供应商默认模型（如 anthropic/claude-haiku）——决策 D2：公开包不硬编码，靠 README 与菜单推荐
  - 观察期后的砍角色动作——届时另立事项

## 背景与证据

用户观察：内置角色 `plan`、`explore` 从未被模型主动选用（含 dogfood 会话）。对比 `@tintinweb/pi-subagents@0.19.0` 后定位到四个机制差异，均已在讨论页对比（talks 已并入本 issue）：

1. **属性 vs 触发**：本包把角色写成括号里的属性注释（"fast read-only search"）；tintinweb 的角色 description 是写给调度模型的祈使触发句（"Use it to find files by pattern…, grep for symbols…, or answer 'where is X defined'"），且带反例边界（"Do NOT use it for code review…"）。
2. **角色不可见**：本包 description 硬编码两个角色名；tintinweb 用 `{{typeList}}` 动态渲染**全部**可用角色及触发描述，含用户自定义。本包自定义角色对模型完全不可见（仅传错名字报错时出现）。
3. **成本激励**：tintinweb 的 explore 默认绑便宜快模型（anthropic/claude-haiku-4.5）——省真钱才是模型绕道的理由；本包 explore 继承父模型。
4. **门槛与措辞**：本包 096/100 的文案把角色门槛升到 "matches the job exactly"，且把卖点写成 "lowest thinking"（读作「最笨」）——两者叠加压制角色使用，模型完全照做。

已确认决策（2026-10-08，用户在讨论页三项裁决）：

- **D1 抄的范围**：typeList 嵌入 + 触发句；guidance 长文不抄。
- **D2 explore 模型默认**：不绑供应商，README 与菜单推荐便宜模型。
- **D3 观察期与退路**：设观察期；若角色仍无主动使用，砍到只剩 `general-purpose`。

版权边界：触发句文本改编自 `@tintinweb/pi-subagents`（MIT，Copyright (c) 2026 tintinweb），README `### Attribution` 已有署名，沿用该来源，不从 Claude Code 摘。

## 现状如何工作

- 四处模型可见文本硬编码于 `src/index.ts`（registerTool 调用处，约 1605-1630 行）。
- `parseAgentFile`（`src/index.ts`）按行解析 frontmatter，目前只认 `model` / `thinking` / `tools`。
- `listDiscoveredAgentNames(cwd)`（`src/settings.ts`）已按 project → agentHome → ~/.pi/agents → 包内 builtins → settings 键的顺序去重收集角色名，`resolveAgentRole` 的报错文本即用它。
- 工具 description 在扩展注册时求值一次；会话中新增角色文档需 `/reload` 才会出现在 roster。

## 操作方案

1. `agents/explore.md`、`agents/plan.md` frontmatter 加 `description:` 触发句；`general-purpose` 是默认模板且被 roster 过滤，不加。
2. `AgentConfig` 增加 `description?: string`；`parseAgentFile` 解析之。
3. `buildAgentRosterText(cwd)`：`listDiscoveredAgentNames` 过滤 `DEFAULT_AGENT_NAME`，逐个 `findAgentDefinition` 取 description，无则裸名。
4. 四处文本重写（保留 096 的 "general-purpose by default" / "Omit 'agent'" 断言锚点）；description 嵌入 roster。
5. `pickModel` 加可选 `hint` 参数；`configureRoleMenu` 在 role 为 explore 时传入推荐语。
6. README、测试、版本号（0.11.0，未发布）。

## 风险与边界

- **行为变更**：角色宣传从「恰好匹配才用」变为「触发即用」，可能矫枉过正（模型开始选角色但选错场景）——靠 explore 触发句里的反例边界（Do NOT use for code review）对冲，观察期（D3）验证。
- **roster 静态化**：注册时求值，会话中新增自定义角色需 `/reload`；README 写明。执行路径不受影响（`resolveAgentRole` 每次调用实时读文件）。
- **测试机器相关**：roster 会列出本机 `~/.pi/agents` 下的自定义角色，测试断言只用内置角色锚点（`- explore:`、触发句片段）＋ `not.toContain("- general-purpose")`，不假设完整名单。
- **明确不碰**：`--tools` 替换语义、模型/思考优先级链、097 的未知角色报错行为、`PI_SUBAGENT_CHILD` 防递归。

## 验证

- `npm --workspace @bytetrue/pi-subagent test`
- `npm --workspace @bytetrue/pi-subagent run typecheck`
- roster 实跑断言（单测覆盖：自定义角色带 description 出现在 roster、无 description 裸名、general-purpose 被过滤）

## 执行记录

2026-10-08 实现完成（同日立项并落地，issue 内方案照做，无偏差）：

- `agents/explore.md`、`agents/plan.md`：frontmatter 增 `description:` 触发句（含 explore 的反例边界与 search breadth 提示），文档头注释说明该字段给调度模型、不进子代理提示词。
- `src/builtin-agents.ts`：`AgentConfig` 增 `description?: string`。
- `src/index.ts`：
  - `parseAgentFile` 解析 `description`（与 model/thinking 同样的行解析）。
  - 新增导出 `buildAgentRosterText(cwd)`：`listDiscoveredAgentNames` 过滤 `general-purpose`，逐个 `findAgentDefinition` 取 description，无则裸名，`\n` 连接。
  - `registerTool` 处：roster 在注册时求值（注释写明 mid-session 文档需 `/reload` 才进 roster、角色解析本身始终实时）；description 改为模板字符串嵌入 roster；promptSnippet / promptGuidelines / `agent` 参数描述同步重写——删 "matches the job exactly" 门槛、删 "lowest thinking" 措辞、roles 宣传改为「roster 里触发句匹配即用」。
- `src/command.ts`：`pickModel` 增可选 `hint` 参数（拼进标题）；`configureRoleMenu` 对 `explore` 传「fast read-only searcher — a cheap, fast model fits it best」提示（D2：不硬编码供应商）。
- `README.md`：Features 加 roster 条目；Built-in roles 后新增 "Role descriptions and the roster" 小节（触发句写法示例、`/reload` 刷新语义、无 description 裸名、general-purpose 不进 roster）；参数表 `agent` 行更新；explore 便宜模型推荐段（含 settings 路径 `agents.explore.model`）；"lowest thinking level" 改 "minimal thinking"。
- 测试（`src/index.test.ts`，+2 用例扩展）：roster 用例（内置角色触发句、general-purpose 过滤、自定义角色带/不带 description 两形态）；schema 用例补 roster 嵌入断言与旧措辞清除断言。096 的四个断言锚点全部保留通过。
- 版本 0.14.0 → 0.15.0（本地立项时工作区还停在 0.10.0、初写为 0.12.0；rebase 到 origin/main 后发现 0.11.0–0.14.0 已随 ff 103–108 发布，npm latest = 0.14.0，故顺延为 0.15.0），`npm version` 同步 package-lock。

**验证**：`npx tsc --noEmit` 干净；`npx vitest run` **55 passed**（54 → 55：新增 roster 用例并入既有 describe）；`npm pack --dry-run` 三个 agents 文档随包；临时 vitest 用例实跑打印 roster 确认渲染（explore/plan 触发句 + 无 general-purpose）。

**实现备注**：roster 行格式 `- name: description` 与 tintinweb typeList 一致，但**不含**其 model/tools 后缀——设置可在会话中被 `/subagent` 修改而 description 不刷新，宁缺毋滥（已记入 issue 遗留段）。

## 遗留

- **观察期（D3）**：时长待用户定夺（建议以数周真实 dogfood 为准）。到期若 `explore` / `plan` 仍无主动使用，砍到只剩 `general-purpose`——届时另立 issue，本 issue 的角色文档与 roster 机制保留（自定义角色可见性不受砍影响）。
- tintinweb 的 model suffix（roster 行尾显示已配置模型）被考虑过并放弃：设置可在会话中被 `/subagent` 修改而 description 不会刷新，宁可不做陈旧信息。

## 关闭结论

**判断：可关。** 三个决策（D1 触发句 + typeList 嵌入、D2 explore 不绑供应商改菜单与 README 推荐、D3 观察期约定）全部落地；范围未暗扩——guidance 长文与供应商默认模型按 D1/D2 明确排除在外，观察期作为约定记入 spec 与本 issue 遗留。

**验证摘要**：

| 证据 | 结果 |
|---|---|
| `npx tsc --noEmit` | 干净 |
| `npx vitest run` | 55 passed（新增 roster 用例并入既有 describe） |
| `npm pack --dry-run` | `agents/{explore,general-purpose,plan}.md` 三文档随包 |
| 096 断言锚点 | 四个「默认路径可见」断言全保留通过 |
| roster 实跑 | explore/plan 触发句渲染正确，general-purpose 被过滤，自定义角色带/不带 description 两种形态均正确 |

**回写位置**：`byissue/spec/pi-subagent/index.md`——模型可见文本段改为 roster 机制描述（含 `/reload` 刷新语义）；内置角色段补 `description:` 触发句说明与「不注入子代理提示词」边界；`/subagent` 段补 explore 菜单提示；新增观察期约定一行。

**交付**：`packages/pi-subagent` 0.15.0。提交与发布经用户授权（2026-10-08），tag `pi-subagent-v0.15.0`；发布记录见下。

**与 ff 105 的关系**：远端同期已发布 0.12.0（ff 105「dynamic role list in agent param, drop role gating」）——纯名字列表进 `agent` 参数描述，无触发句、无 description frontmatter、无 roster 嵌入 description。本 issue 是它的深化：roster 连同触发句渲染进工具 description 主文本，自定义角色带各自触发描述可见；rebase 时冲突以本 issue 版本为准，105 的「动态可见 + 无门槛」意图断言保留（`pass 'agent' only when` 禁句断言仍在）。

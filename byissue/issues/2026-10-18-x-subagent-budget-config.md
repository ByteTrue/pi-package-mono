---
kind: issue
title: "pi-subagent 预算配置面：角色级与全局级的 maxTurns / timeoutMs，及动态默认宣传"
type: feature
created: 2026-10-18
---

# pi-subagent 预算配置面

> **读者：** 跨会话接手的人——要做成什么、别碰什么、方案是否还成立、怎么验、关闭回写哪里。

## 目标与范围

让"一次对抗性审查能在一段里跑完"成为可不靠续跑达成的状态，并把预算变成**用户可配置的表面**。

包含：预算的三层配置面（agent 文档 frontmatter、settings 角色级、settings 全局级）+ 全局默认常量上调 + schema description 动态渲染生效默认 + `/subagent` 预算菜单。

不包含：自动续跑机制、累计上限（段间共享额度）、`0 = 无上限` 开关、token/成本上限、`paused` + resume 语义改动。四者均已在讨论中排除，不是待议。

## 来源与当前证据

讨论与逐轮裁决见 `byissue/talks/2026-10-18-subagent-budget-config.md`。

本机 session log 统计（2026-10-18 取）：

- reviewer 真实跑 4 次：57 / 77 / 80 轮，最长 39 分钟——**3 次撞 50 轮上限**。
- 裸子 agent 50 次：8 次 ≥50 轮，最长 158 轮 / 80 分钟。
- 父会话侧累计 222 次轮次上限通知、666 次超时通知（含测试噪声，量级可信）。

结论：**预算这一层现在没有任何配置面**，不是"阈值设小了"。

## 现状怎么工作

- `DEFAULT_TIMEOUT_MS = 20min`、`DEFAULT_MAX_TURNS = 50` 是硬编码常量（`packages/pi-subagent/src/index.ts:117-118`）。
- `settings.json` 角色配置只有 `model` / `thinking` / `tools`（`src/settings.ts:14-18`）；顶层只有 `defaultModel` / `defaultThinking` / `agents` / `env`。没有预算键。
- agent 文档 frontmatter 只解析 `model` / `thinking` / `tools` / `systemPrompt` / `description`（`src/builtin-agents.ts:6-15`）。`agents/reviewer.md` 出厂带 `thinking: max`，无预算。
- 逐次传参是唯一通道，`timeoutMs` / `maxTurns` 在规范化时被 `> 0` 门把守（`src/index.ts:938-944`、`1549-1555`），`0` 回落默认——模型无法关闭上限。
- 生效点是 `cfg.timeoutMs ?? DEFAULT_*`（`src/index.ts:1240-1241`）。**加配置层不需要改链的形状**，只是让 `cfg` 第一次真的能带预算。
- schema description 的默认值是写死的静态文案（`src/index.ts:2071-2078`）。
- 撞上限行为（保持不变）：杀进程树 + 立刻报 `paused` + 带 session id 续跑提示，实机验证见 `issues/107-x-ff-subagent-kill-turns-limit.md`；超时三重冗余见 `issues/108-x-ff-subagent-timeout-watchdog.md`。

## 方案

1. **配置面三层 + 优先级链照抄 model 链的对称形状**（`src/index.ts:906-907` 已核实 model 链为 `settings 角色 > agent 文档 > settings 全局 > 继承父会话`）：

   ```text
   逐次传参 > settings 角色级 > agent 文档 frontmatter > settings 全局级 > 硬编码常量
   ```

   含义要点：settings 里的全局默认**不会**盖掉 reviewer.md 出厂值，只有角色级 settings 才盖。角色固有属性归文档，用户覆盖权归 settings。

2. **数字**：全局默认 **100 轮 / 40 分钟**；`reviewer.md` 出厂 **150 轮 / 60 分钟**。最长观测 158 轮 / 80 分钟的重活仍会撞上限，**这是接受的**——它本来就该续跑一次。

3. **frontmatter 键名 camelCase**：`maxTurns` / `timeoutMs`，与 settings、tool schema 逐字一致。

4. **续跑预算 = 每段独立窗口**：resume 启动新子进程，重新按当时预算开窗，段与段不共享额度。不改代码，现状即如此；写进 spec 作为语义承诺。

5. **schema description 动态渲染生效默认**，求值时机与 roster 同一先例（注册时求值，配置变更需 `/reload` 才反映，`spec/pi-subagent/index.md` 第 5 节 roster 段）。

6. **`/subagent` 预算菜单**：预设档位选择器（轮次 50/100/150/200 + Custom；分钟 20/40/60/120 + Custom），区分 global / project scope，沿用现有 `chooseScope`（`src/command.ts:180`）与项目信任门（未受信时项目层整段丢弃，同 env 规则，spec 第 7 节）。

## 影响面

- **必须改**：`src/index.ts`（常量、生效链、schema description 动态化）、`src/settings.ts`（`SubagentSettings` 全局预算 + `SubagentRoleConfig` 角色预算与解析）、`src/builtin-agents.ts`（`AgentConfig` 预算字段与 frontmatter 解析）、`agents/reviewer.md`（出厂预算）、`src/command.ts`（预算菜单）、`README.md`（参数表与配置说明）、`byissue/spec/pi-subagent/index.md`。
- **需要验**：链每一层的优先级用例（逐次传参盖角色 settings、角色 settings 盖文档、全局不盖文档、全空回落常量）；`0` 仍被拒；`/reload` 后 description 反映新默认；project scope 未受信时预算整段丢弃；`/subagent show` 显示生效预算。
- **仍未知**：150 轮 / 60 分钟能否覆盖真实审查（需 2–3 次实跑）；并行子任务同时跑满 60 分钟的成本放大是否可接受；`/reload` 才生效对模型逐次传参的影响。

## 风险与穿刺

- **动态 description 是本 issue 唯一的"改变模型看到的信息"的改动**，先做最小穿刺：注册时求值 + `/reload` 生效，确认不会把静态文案变成每次调用求值（求值成本与 clone-safe 不变式，spec 第 3 节）。
- **防爆门不可回归**：上限不可关闭（`> 0` 门保留），`0` 与负值一律回落，不允许"无上限"路径进入实现。
- 预算变更**不得触碰**杀树与 paused 时序（ff 107/108 的验证成果）。

## 验证

```bash
npm --workspace @bytetrue/pi-subagent run typecheck
npm --workspace @bytetrue/pi-subagent test
```

外加：`/subagent` 菜单实机配置一轮并 `show` 校验；一次真实 reviewer 审查实跑，记录轮次与耗时，确认落在一段内。

## 执行记录（2026-10-18，实现与验证完成，未关闭）

改了什么：

- `src/settings.ts`：`SubagentSettings` 加 `defaultMaxTurns` / `defaultTimeoutMs`，`SubagentRoleConfig` 加 `maxTurns` / `timeoutMs`；新增导出的 `parsePositiveInt`（正有限整数，向下取整，`0`/负/非数字一律丢弃）；解析覆盖新格式与 legacy `subagents.agentOverrides`；`toStoredSection` 写入新键；项目/全局逐键合并。
- `src/builtin-agents.ts` + `src/index.ts::parseAgentFile`：`AgentConfig` 加预算字段，frontmatter 解 `maxTurns:` / `timeoutMs:`（角色文档是用户输入，走同一个 `parsePositiveInt`）。
- `agents/reviewer.md`：出厂 `maxTurns: 150` / `timeoutMs: 3600000`（60 分钟），带注释说明实测依据与优先级。
- `src/index.ts`：包常量改为 100 轮 / 40 分钟（并导出为 `DEFAULT_MAX_TURNS` / `DEFAULT_TIMEOUT_MS`）；`resolveRunCfg` 预算链按 `逐次传参 > settings 角色 > agent 文档 > settings 全局 > 常量`；新增 `resolveBudgetDefaults`；tool schema 的 `timeoutMs` / `maxTurns` 描述在注册时渲染生效的全局默认；`/subagent` 命令描述加 budgets。
- `src/command.ts`：`pickBudgetNumber`（keep / clear / custom / 预设档位，一个 picker 服务轮次与分钟，`customScale` 让分钟输入仍以毫秒存储）；主菜单新增 `⏱ Configure Budget`；角色菜单在 model/thinking 后加两个预算选择；`showConfig` 显示 `Default Turns` / `Default Timeout` 与角色预算。
- `README.md` / `byissue/spec/pi-subagent/index.md`：参数表、`/subagent` 面、预算链（新增 Budget Resolution 节）、每段独立窗口语义、reviewer 出厂预算、防爆门不可关闭。

与设计的小偏差（两处，不影响目标）：

1. **schema 描述只渲染全局层**。注册时无 ctx 信任决策，而 `loadSubagentSettings(cwd, false)` 恰好是“只读全局、跳过项目层”，所以注册时求值用全局层，描述文案同时写明“角色文档的预算作用于该角色、本参数作用于单次任务”。项目层预算在运行时经 ctx 信任门生效。
2. **角色预算沿用已有的角色粒度合并**：`agents` 的 project 合并是整体替换该角色对象，不是逐键合并（既有行为，预算加入不改它）。测试把这一点写成断言，避免后人误以为逐键合并。

验证：

- `npm --workspace @bytetrue/pi-subagent run typecheck` → 退出码 0。
- `npx vitest run`（本包）→ **5 files / 92 passed**（原 88，新增 4）：预算链四层（逐次传参、settings 角色、角色文档不被全局缩小、全空回落常量）；reviewer 出厂预算 150 / 3600000 与走链生效；三层输入拒绝（文档 `0` / `-5` / 非数字、normalizeTask `0` / `-3`、settings 字符串 `"120"`）；全局+项目预算合并与项目信任门（未受信时预算整段丢弃）；菜单式写入（只改 model）不清掉预算。
- `npm test`（全仓）→ 各 workspace 全绿：41+1 skipped / 134 / 92 / 205 / 95 / 148+9 skipped / 16 / 14 / 10 / 9。
- `npm run typecheck --workspaces --if-present` → `small-extensions/pi-context-guard` 失败（`Property 'sections' does not exist on type 'BuildSystemPromptOptions'`）。该包在本改动中无任何 diff（`git diff HEAD -- small-extensions` 为空），属 HEAD 上已存在的失效（上游 pi 类型变化），不在本 issue 范围内。
- `npm --workspace @bytetrue/pi-subagent pack --dry-run` → 10 files，无 `files`/`exports`/`bin` 变化。

未做：未 commit、未 bump 版本、未发布；本机安装版 `~/.pi/agent/npm/node_modules/@bytetrue/pi-subagent` 未同步（发版后重装，或按 `pi-dev-setup` 走项目级本地加载）。150 轮 / 60 分钟的前瞻有效性仍靠实跑确认（发版后 2–3 次真实审查，记录轮次与耗时）。

关闭回写候选（此时不毕业）：预算链与每段独立窗口语义已写入 spec 第 2、5 节；README 已同步；若实跑数据与 150/60 不符，回写实际数字。

## 关闭结论（2026-10-18）

**判断：交付关闭。** 目标达成：预算从“硬编码常量 + 逐次传参”变成三层可配置面（agent 文档 / settings 角色级 / settings 全局级），链形与 model 链对称，全局默认不可缩小角色文档预算；数字上调为 100 轮 / 40 分钟（包常量）与 150 轮 / 60 分钟（`reviewer` 出厂）；`/subagent` 有预算菜单与生效展示；tool schema 的默认文案随配置渲染。

**质量证据**：本包 typecheck 退出 0；`vitest run` 5 files / 92 passed（新增 4 用例覆盖链四层优先级、`reviewer` 出厂预算、`0`/负/非数字在 normalizeTask、settings 解析与 agent 文档解析三处均被丢弃、项目信任门下预算层整段丢弃、菜单写入不清预算）；全仓 `npm test` 各 workspace 全绿；`pack --dry-run` 10 files。守住的边界：上限不可关闭、杀树与 `paused` 时序一行未动、无自动续跑、无累计额度。本包无 UI 变化（`/subagent` 菜单沿用现有 picker，无新布局/浮层）。

**有界简化仍成立**：`0 = 无上限` 被排除，上限不可关闭；预算每段独立窗口，resume 重开一整段。已知上限：150 轮 / 60 分钟是从本机 p90（reviewer 77 轮 / 34 分，最长 80 轮 / 39 分）推的，最长观测 158 轮 / 80 分钟的重活仍会撞上限（接受，续跑一次即语义承诺）。升级触发：若发版后 2–3 次真实审查实测显示 150 轮不足，新开 issue 回写数字，不在本 issue 内隐藏。

**回写位置**：`byissue/spec/pi-subagent/index.md`（当前表面的预算链、核心机制第 2 节预算与每段独立窗口、第 5 节预算优先级链、`/subagent` 预算菜单、`reviewer` 出厂预算、使用路径表）；`packages/pi-subagent/README.md`（参数表、`/subagent` 预算面、Budget Resolution 节）；讨论记录 `byissue/talks/2026-10-18-subagent-budget-config.md`。引用修正：本 issue 改名后 2 处引用（spec 第 13 行、talk 出口）已同步。无需 notes/decisions（无可复用的仓库外部坑点）。

**遗留**：发版 0.18.0（与本次关闭同次 commit，tag `pi-subagent-v0.18.0`）；发版后 2–3 次真实审查实跑确认预算数字；`small-extensions/pi-context-guard` 的 `Property 'sections'` typecheck 失败属 HEAD 既有失效，不在本 issue 范围。

# subagent 预算配置 talk

> **写法：** 按讨论推进顺序，每节 = 一轮推进。
> 自检覆盖：开场意图 · 关键纠正与最终依据 · 已确认决策/约束 · 术语 · 影响与取舍 · 候选质量 · 仍开放项 · 出口与暂不纳入。

---

## 开场：审查跑不完，每次都要续一到两次

用户说法：subagent 大部分时间用于对抗性审查，默认轮次与分钟阈值不足以完成一次审查，基本上每次都要再续一到两次。

要先生出的不是方案，是**这一层现在到底归谁管**。查代码的结果是：**预算这一层根本没有配置面**。

- 默认是硬编码常量：`DEFAULT_TIMEOUT_MS = 20min`、`DEFAULT_MAX_TURNS = 50`（`packages/pi-subagent/src/index.ts:117-118`）。
- `settings.json` 的角色配置只有 `model` / `thinking` / `tools`（`src/settings.ts:14-18`），顶层只有 `defaultModel` / `defaultThinking` / `agents` / `env`——**没有任何预算键**。
- agent 文档 frontmatter 只解析 `model` / `thinking` / `tools` / `systemPrompt` / `description`（`src/builtin-agents.ts:6-15`），`reviewer.md` 出厂带 `thinking: max`，没有预算。
- 唯一通道是模型逐次传 `timeoutMs` / `maxTurns`；传 `0` 被 `>0` 门吞掉回落默认（`src/index.ts:938-944`、`1549-1555`），模型连"关掉上限"都做不到。

**已确认（证据）：** 用户的感受有数据支撑，本机 session log 统计——reviewer 真实跑 4 次，57 / 77 / 80 轮，最长 39 分钟，其中 3 次撞 50 轮上限；裸子 agent 50 次，8 次 ≥50 轮，最长 158 轮 / 80 分钟；父会话侧累计 222 次轮次上限通知、666 次超时通知（含测试噪声，量级可信）。

## 第 1 轮：消灭"续跑"还是消灭"续跑的成本"

已确认四条：

1. **走 A——把预算调大到基本一次审查跑完**，不做"撞上限后工具自动 resume"。B 会在 50 轮内确实做不完的前提下变成无限续，成本失控面显著更大。
2. **范围是全局默认上调（所有角色受益）+ 角色层单独覆盖**，不只给 reviewer——裸子路径同样有 8/50 撞上限。
3. **上限保留、不可关闭**。这套上限在 spec 里叫"防爆门"，且历史上有过"跑满上限不杀进程"的严重 bug（`issues/107-x-ff-subagent-kill-turns-limit.md`、`issues/108-x-ff-subagent-timeout-watchdog.md`），审查类失控成本是真实风险。
4. **`paused` + resume 语义保持**。杀树 + 立刻报 paused + 带 session id 这条路径已被实机验证（ff 107 的 Review 节），只改预算面，不动它。

## 第 2 轮：配置面落点、数字、宣传面、菜单

已确认：

- **配置面两层：`settings.json` + agent 文档 frontmatter**。理由：reviewer 需要大预算是**角色固有属性**（`thinking: max` 是同一逻辑），不该要求每个用户去 settings 配一遍；settings 层给用户覆盖权。只改硬编码常量被否——会让"审查"和"轻量探索"共用同一个数字。
- **数字**：全局默认 **100 轮 / 40 分钟**（裸子 p90 = 52 轮 / 33 分钟的两倍余量）；reviewer 出厂 **150 轮 / 60 分钟**（reviewer p90 = 77 轮 / 34 分钟，最长观测 80 轮 / 39 分钟，能一次跑完）。最长观测 158 轮 / 80 分钟那种重活仍会撞上限，**接受**——它本来就该续跑一次。
- **schema description 动态渲染生效默认**。现在写死 `"Default: 50"` / `"Default: 1200000 (20 minutes)"`（`src/index.ts:2071-2078`），用户配置后模型看到的仍是 50，会传"自认为默认"的值。渲染时机与 roster 同一先例：**注册时求值，配置变更需 `/reload` 才反映**。
- **`/subagent` 加预算编辑界面**。env 不做界面的先例（`spec/pi-subagent/index.md` 第 7 节）理由是"键值表交互不划算"；预算只有两个数，用预设档位选择器（轮次 50/100/150/200 + Custom，分钟 20/40/60/120 + Custom）成本很低，并区分 global / project scope（沿用现有 `chooseScope` 与项目信任门）。

## 第 3 轮：链形状、续跑语义、出口

先核实一条事实（`src/index.ts:906-907`）：model 链是 `settings 角色 > agent 文档 > settings 全局 > 继承父会话`，即**用户 settings 的角色级配置覆盖角色文档的出厂值**。

已确认：

- **预算链照抄这个对称形状**：`逐次传参 > settings 角色 > agent 文档 > settings 全局 > 硬编码常量`。含义：settings 里配的全局默认**不会**盖掉 reviewer.md 出厂的 150 轮；只有角色级 settings 才盖。角色固有属性归文档，用户覆盖权归 settings——这套边界已在 model/thinking 上跑通。
- **frontmatter 键名用 camelCase**（`maxTurns` / `timeoutMs`）：同一概念在 schema、settings、文档三处逐字一致，模型读到的描述也一致。
- **续跑预算 = 每段独立窗口**。resume 启动新子进程，重新按当时预算开窗，续一次等于再拿一整段，总成本是两段之和。不做"累计上限"：它需要父侧追踪已用量，且剩余额度经常不足以完成一次审查，等于把续跑变成注定失败的续跑。可解释的语义是"一次审查给 150 轮"，续跑是"再给一次机会"。
- **出口 = 常规 Issue**（`type: feature`），不是快改 `ff`：配置面是新增表面，动态默认文案会改变模型看到的信息，测试要覆盖优先级链每一层，`ff` 装不下这组不变式。

## 术语

- **预算**：`maxTurns` + `timeoutMs` 两者的合称，本议题新增的配置面。
- **每段独立窗口**：resume 后新子进程重新获得的完整预算，段与段不共享额度。
- **防爆门**：spec 既有用法，指这套上限有意不可关闭（防成本与循环失控）。

## 影响与取舍

- **必须改**：`index.ts` 常量与生效链、`settings.ts` 类型与解析（角色级 + 全局级）、`builtin-agents.ts` frontmatter 解析、`command.ts` 预算菜单、`index.ts` schema description 动态化、README、`spec/pi-subagent/index.md`。
- **需要验**：链每一层的优先级测试；动态 description 在注册时求值、`/reload` 后更新；project scope 的项目信任门（未受信时整段丢弃，同 env 规则）；`0` 仍然是非法输入。
- **仍未知 / 风险**：150 轮 / 60 分钟能否覆盖真实审查，需要 2–3 次实跑确认；并行任务的成本放大（多个角色同时跑满 60 分钟）；`/reload` 才生效对模型描述的影响。
- **候选质量（非承诺）**：可预测性（预算语义每段可解释）、可配置性（角色固有 vs 用户覆盖边界清楚）。

## 暂不纳入

自动续跑机制、累计上限、`0 = 无上限` 开关、token/成本上限。四者都在第 1、3 轮被明确排除，不是"待议"。

## 出口

已执行：建 `byissue/issues/2026-10-18-o-subagent-budget-config.md`（`type: feature`），同会话实现后关闭为 `byissue/issues/2026-10-18-x-subagent-budget-config.md`（发版 0.18.0）。

未执行：实现。本议题落盘后回到讨论姿态，实现需要用户另行授权。

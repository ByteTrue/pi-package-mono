# 后台工具的"等待"心智模型 → 正向优先提示词判据 + subagent 纯后台

## 开场：两个看似独立的问题

用户提出两件事：

1. subagent 已有 `async` 后台能力，但模型绝大多数时候仍走前台阻塞自己；是否干脆全部改成后台。
2. 用 `background_run` 之后，模型有时会另起一个 `sleep N` 的 bash 把自己阻塞——用户判断这是提示词工程没做好，模型不明白后台命令跑完会通知。

## 查证：两个问题同根

读了 `packages/pi-background-terminal/src/tools/background-run.ts:44-52`（description + 五条 promptGuidelines + 返回文本）和 `packages/pi-subagent/src/index.ts` 的工具注册、后台通知：

- 模型没有「结束回合 = 等待，通知 = 唤醒」这个心智模型。它只有「要结果 → 阻塞」一条路，所以 subagent 走前台、`background_run` 之后拿 `sleep` 自阻塞。
- 现有 guideline 只禁了 `background_status` 轮询，既没提 `sleep`，更没说"等 = 结束回合"——只删路，不给路。
- 第五条 guideline（"bash 超 600s 硬杀 → 用 background_run"）把**要结果的慢命令**推向后台，和 079 的选择轴（要结果 → bash）冲突；内建 bash 本有 `timeout` 参数，正确说法是传更大的 timeout 给 bash。
- 返回文本 `You will be notified when it exits` 是陈述句，没告诉模型当下该做什么。
- subagent 工具**没有任何 promptGuidelines**，`async` 描述只有一句。
- 后台 subagent 的通知 `formatSubagentExitMessage` 把 `task.output` 全文塞进 followUp，所以后台不丢信息，前台没有信息优势；前台阻塞的真实代价是用户几分钟不能插话。
- 后台的隐藏代价：实时进度卡 `renderProgressCard` 依赖 tool call 的 `onUpdate`，后台路径传 `undefined`（`index.ts:1762`），后台只剩 `sub:N` 和 `/subagent` 菜单。
- print 模式（`pi -p` / `--mode json`）：进程跑完一回合就退，后台任务的 followUp 没有下一回合可送达。

第一轮给了三个选项（A 只改提示词 / B 默认翻 async 保留逃逸口 / C 纯后台删前台）和一个可选的 `sleep` 拦截 hook。

## 纠正一：拦截不做；先探讨"否定"理论

用户否决了 `tool_call` 拦截 `sleep` 的护栏（不优雅），并提出 Matt 的理论：否定会激活被禁行为（"不要想大象"），禁令半读成邀请；想借此全面优化仓库提示词。

助手的判断：理论有两个机制，强弱不同——

- **弱效应（显著性）**：否定句把被禁行为的 token 放进上下文，模型犹豫时它更顺手；现代模型能压住，效应不大。
- **强效应（真空）**：禁令只删一条路，不给替代路；模型仍要行动，就选最近的那条，常是被禁行为的变体。`sleep` 正是这个。

因此不采用"删掉所有 never"，而是一条判据（见下文决策）。按判据扫了全仓库面向 LLM 的文本（promptGuidelines / promptSnippet / tool description / 内置 agent systemPrompt / SKILL.md）：

| 包 | 面向 LLM 的否定 | 判断 |
|---|---|---|
| pi-background-terminal | 2 条，均无替代动作 | 真空型，主因，必改 |
| pi-subagent 工具 | 0 条 guideline | 缺正向指引 |
| pi-subagent 内置 agents | 3 条，前两条同句已带正向；"Do not modify files" 应由工具层管（reviewer 有 bash） | 三行改序 |
| pi-vision | 1 条，带正向 | 强默认型，保留 |
| pi-image-gen SKILL | ~5 条，凭据/格式边界 | 低优先级 |
| pi-vendor SKILL | ~25 条 never/do not | 密度最高、风险最大，但全是不可逆 mutation/凭据边界，且是调出来的——单独立 issue，配验证场景 |
| pi-mcp / pi-web-search / pi-browser | 基本没有 | 无事 |

## 纠正二：进度卡搬状态栏，C 变便宜

用户提出：subagent 进度直接搬到状态栏（简略），`/subagent` 菜单进去看详细进度卡，二者不冲突。助手确认可行：后台路径也传 `onUpdate`，把 `ProgressDetails` 写进 `subagentManager` 的任务记录，**一份数据、两个视图**——状态栏 `sub:N · role elapsed`（宽度有限，只显示数量 + 最老任务），菜单单任务页复用现成 `renderProgressCard`。这样前台路径没有独有价值，可直接删，C 不再需要拆成两步。

## 解释：print 模式

`pi -p` / `--mode json` 是非交互一次性运行，跑完一回合进程退出；后台任务靠 `followUp + triggerTurn` 在下一回合送达，没有下一回合就丢。暴露面只有"脚本跑 `pi -p` 且期望里面用 subagent"。079 对 terminal 已接受"任务随进程死"。

## 已确认决策与安排（用户："都按推荐来"）

1. **判据立碑**：每条面向 LLM 的规则先说该做什么；否定只在 (a) 被禁行为是模型强默认、(b) 安全/不可逆边界 两种情况保留，且必须紧跟替代动作。→ `byissue/decisions/001-positive-first-prompting.md`
2. **本次 ff 范围**：background-terminal 五条 guideline + description + 返回文本；subagent 补 promptGuidelines / 描述；builtin-agents 三行。`sleep` 这个词不出现在提示词里。→ `byissue/issues/087-x-ff-positive-first-background-prompts.md`
3. **subagent 直接走 C**：纯后台 + 进度搬状态栏/菜单 + 删前台，常规 issue。→ `byissue/issues/088-o-subagent-pure-background.md`
4. **pi-vendor SKILL 按判据重写**：单独 issue，需配验证场景。→ `byissue/issues/089-o-vendor-skill-positive-first.md`
5. **print 模式**：接受后台 subagent 结果随进程丢，写进 spec「明确不做」，不加回落分支。

## 术语

- **真空型否定**：只删路不给路的禁令；模型会用被禁行为的变体填补。
- **结束回合即等待**：后台任务的正确等待方式是继续做别的或结束当前回合，退出通知会开启下一回合。

---

## 出口

- 已执行：decision 001；ff 087（本会话实现并关闭）；issue 088、089 建档。
- 暂不纳入：`sleep` 拦截 hook（用户否决，不优雅）；pi-image-gen SKILL 措辞微调（低优先级，若 089 方法论跑通再顺手）；print 模式前台回落。

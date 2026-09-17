---
kind: issue
title: "pi-vendor SKILL.md 按正向优先判据重写"
type: chore
status: closed
created: 2026-09-17
---

# pi-vendor SKILL.md 按正向优先判据重写

> 来源：`byissue/talks/007-background-wait-model-and-positive-prompting.md`；判据：`byissue/decisions/001-positive-first-prompting.md`。

---

## 做成以后是什么样

`packages/pi-vendor/skills/pi-vendor/SKILL.md` 中每条规则先说该做什么；保留的否定只属于 (a) 模型强默认（如把用户文本直接当模型 ID、手抄 plan 里的 ID 集合）或 (b) 安全/不可逆边界（凭据、`auth.json`、exact sync 的 plan 权威），且每条紧跟替代动作。技能行为不变：五个 workflow、脚本调用形态、确认与断言序列、凭据零泄露。

**范围：** 只改 SKILL.md 措辞与结构；不改脚本、不改 workflow 数量与步骤顺序。

## 为什么单独立 issue

这份 skill 有约 25 条 never / do not，是全仓库密度最高的一处——"一墙 never 读成菜单"的风险最大。但它们几乎全是不可逆 mutation 与凭据边界，且这份文本是反复调过的；顺手改有回归风险，需要配验证场景。

## 动哪些、验哪些

- 逐条分类现有否定：真空型（改写为正向 + 可删否定）/ 强默认型（正向前置，否定保留为尾注）/ 安全边界型（保留，确认已带替代动作，如"Refer to it only as configured, missing, or changed"）。
- 验证场景（至少）：
  1. 用户给模糊模型名（如「千问 3.7」）→ 走 catalog 搜索、展示映射、不直接写 ID。
  2. exact sync → 展示 plan JSON 原文、拿到确认、before/after 断言，不手写 ID 列表。
  3. 用户在聊天里粘贴 key → 不执行 set-key、不复述 key。
  4. 更新单字段 → 其他字段与 key 顺序不变。
  5. anthropic-messages + trailing `/v1` → 模型级 baseUrl 剥 `/v1`。
- 对照改前/改后各跑一遍，行为一致才算通过。

## 执行记录

逐条分类后重写 `SKILL.md`（+48/−47 行）：

- **安全边界型**（凭据、auth.json/设置、全文件读、验证时的输出）：改为“只用 X 形式提及”。例：“Never reproduce one…” → “refer to it only as configured, missing, or changed — in replies, diffs, logs, tool arguments, and summaries alike”；“Do not mutate auth.json…” → “Edit only models.json, and in it only the requested provider/model”。全文件读保留一句带理由的尾注（强默认）。
- **强默认型**（把用户文本当 ID、手抄 plan 列表、顺手算集合差）：正向前置 + 替代动作。例：“Do not type any model ID outside that JSON block” → “Every model ID the user sees comes from that JSON block, quoted as-is”；“Do not calculate or present configured/unconfigured sets” → “report the routes and IDs as returned; set comparisons belong to exact synchronization only”。
- **真空型**：直接换成该做的事。例：“Do not guess unresolved routing” → “ask for anything unresolved”；“Do not upsert silently” → “the edit waits for that answer”；“Do not rewrite a clean file” → “A clean file gets a clean report and no edit”。
- 保留的否定：两处描述性 never（“only model IDs…, never credentials”；“from the assertion template, never from a hand-built list”），均紧跟正向表述；定义性 “is not evidence / is not proof” 不动。
- 不变量：三个 Node 程序与所有代码块 md5 相同；五个 workflow、每步编号、章节数（54）相同；确认/断言序列不变。
- Frontmatter description 同步改为正向（触发句 “Use for any models.json…” 保留）。

## 验证

- 结构：`awk` 抽代码块 md5 前后一致；`rg -c` 标题/步骤数 54 = 54。
- 契约测试：`skill-contract.test.ts` 钉了三句旧措辞原句，按同等契约换为新表述（plan 唯一权威 / 官方模板 key order / Enforcement Gate 显式报告），174 passed。
- 行为对照：五个场景（模糊模型名 / exact sync 确认 / 聊天里粘 key / 单字段更新 / anthropic-messages + `/v1`）由两个只读 subagent 分别持改前、改后版本做角色演练，结果：五个场景的首步动作、拒绝/推迟项、引用的 workflow/step 全部一致。可观察的差别只在转述用词：持新版的 subagent 用正向动作描述规则（"refer to arrays by name"、"the model inherits it unchanged"），持旧版的用禁令描述（"never type a, b, c, d"、"do not add"）。

## 关闭结论

- 用户验收通过（五场景行为对照一致 + 契约测试 + 单测全绿）。
- 回写 `byissue/spec/pi-vendor/index.md`：AI Skill 段补一句「措辞遵循 decision 001 正向优先」。
- 遗留：无。

## 关闭时

- 回写 `byissue/spec/pi-vendor/index.md`（若 spec 引用了 SKILL 的规则表述）。
- 若判据在实践中需要细化（例如安全边界型的固定句式），更新 decision 001 或立新 decision。

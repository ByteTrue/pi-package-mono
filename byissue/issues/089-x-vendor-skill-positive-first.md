---
kind: issue
title: "pi-vendor SKILL.md 按正向优先判据重写"
type: chore
status: open
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

## 关闭时

- 回写 `byissue/spec/pi-vendor/index.md`（若 spec 引用了 SKILL 的规则表述）。
- 若判据在实践中需要细化（例如安全边界型的固定句式），更新 decision 001 或立新 decision。

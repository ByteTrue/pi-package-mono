---
kind: issue
title: "pi-vendor SKILL 增加模型顺序整理流程"
type: ff
status: closed
created: 2026-09-08
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# pi-vendor SKILL 增加模型顺序整理流程

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `codestable/` 有无影响。

---

把 2026-09-08 CFG 会话里确认的整理约定固化为 pi-vendor 收尾步骤：mutation 完成并通过 mandatory final verification 后，检查刚编辑的整个 models.json（每个 provider 的 `models` 数组，不止本次改动的 provider）是否符合约定顺序（家族 A-Z，家族内按 models.dev `release_date` 升序）；任一 provider 不整齐则询问用户是否整理整个文件（局部整理无意义，用户明确要求全文件范围），确认后做仅重排对象、不改字段的窄编辑，再重新过离线验证。家族与日期只取自 models.dev，匹配不到就问用户，不猜。

- 改动：`packages/pi-vendor/skills/pi-vendor/SKILL.md` — 新增 "Model ordering" 一节，并在 "Mandatory final verification" 收尾报告句中挂上顺序检查钩子
- 改动：`codestable/spec/pi-vendor/index.md` — AI Skill 职责清单增加对应一条
- 验证：SKILL.md 与 spec 措辞互相对照；规则与 #716（AI-first，不加第三个 script 子命令）、#1250/#1257 验证门不冲突；排序编辑走既有 mandatory verification 复跑
- codestable：已同步 `spec/pi-vendor/index.md`

顺手发现（可选）：SKILL.md 旧句 "check model ordering (next section)" 依赖节序，若日后重排章节需同步改写。

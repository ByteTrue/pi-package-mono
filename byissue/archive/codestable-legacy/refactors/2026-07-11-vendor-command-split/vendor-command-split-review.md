---
doc_type: refactor-review
refactor: 2026-07-11-vendor-command-split
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-11
round: 2
prior_review: .codestable/gates/2026-07-11-vendor-command-split-review.md
note: round-1 was self-only and invalid as gate; round-2 runs independent reviewer + OCR on commit 209fc25
---

# vendor-command-split 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/refactors/2026-07-11-vendor-command-split/vendor-command-split-refactor-design.md`（status: approved）
- Checklist: `vendor-command-split-checklist.yaml`（steps 1–4 done）
- Apply notes: `vendor-command-split-apply-notes.md`
- Evidence pack / gate / DoD: none（refactor 标准路径）
- Implementation evidence: commit `209fc25`；test 44 + typecheck 绿
- Diff basis: `git show 209fc25`（`21852f6..209fc25`）
- Baseline dirty: none（已提交）

### Independent Review

- Detection: pi-subagents `reviewer` 可用；`ocr` CLI 可用（`ocr llm test` 连接成功，exit 1 为 CLI 包装噪音）
- 环节 A 独立 Task agent: native-agent（pi-subagents reviewer, fresh）+ completed
- 环节 B OCR CLI: completed（`ocr review --from 21852f6 --to 209fc25`，6 files / 10 comments）
- OCR severity mapping: High→blocking/important；Medium→nit/suggestion；Low→discarded
- Merge policy: 各环节结果经主 agent 本地事实核验后合并；OCR 命中 `.codestable/` 的已丢弃（本 range 无）
- Gate effect: round-2 满足 `reviewer: subagent+ocr`；round-1 `self` 不能作为有效 gate

## 2. Diff Summary

- 新增：`model-list.ts`, `model-list.test.ts`, `models-menu.ts`, `provider-menu.ts`, `vendor-ui.ts` + refactor 产物
- 修改：`command.ts`（595→92），`finding-05.md`
- 删除：无（逻辑搬移）
- 风险热点：TUI 状态机无自动化测试；交互路径依赖行为等价搬移

## 3. Adversarial Pass

- 假设的生产 bug：搬移后 Escape/Cancel/Back 语义漂移，或 save/rename 确认漏分支
- 主动攻击：漏 import、return 路径、循环依赖、public API、测试假阳性、replaceModelAtIndex 合并语义
- 结果：无 blocking 回归；TUI 无 e2e 与既有 replace 语义进 residual-risk / important（既有缺口）

## 4. Findings

### blocking

none

### important

- [ ] REV-001 `packages/pi-vendor/src/models-menu.ts` / `provider-menu.ts`（整文件）TUI 无自动化覆盖
  - Evidence: 无 command 级 test；apply-notes HUMAN 靠用户「继续」；独立 reviewer 与 OCR 均未发现逻辑回归，但 CI 不能证明菜单状态机
  - Impact: Escape/Cancel/Save/Rename 等交互回归可能绿测通过
  - Expected fix scope: 发布前人工点 apply-notes 清单；长期可 mock `ctx.ui` 做表驱动测（非本 refactor 必做）
  - Source: subagent
  - Disposition: **accepted residual for this refactor**（design 已标 HUMAN；行为等价静态对照 + typecheck 通过）

- [ ] REV-002 `packages/pi-vendor/src/model-list.ts` `replaceModelAtIndex`（约 26–33）先删 index 再按 id upsert
  - Evidence: test 明确「replace index0(a) with id=b → 只剩 b」；与拆分前相同
  - Impact: 编辑 JSON 把 id 改成已有 id 会合并丢条目——**既有语义，非回归**
  - Expected fix scope: 另开 issue 若要改产品语义；本 refactor 不得改
  - Source: subagent
  - Disposition: **pre-existing, out of scope**

### nit

- [ ] REV-003 `packages/pi-vendor/src/vendor-ui.ts:48` 嵌套三元 placeholder（OCR medium→nit；拆分前即有）
- [ ] REV-004 `packages/pi-vendor/src/vendor-ui.ts:54+` `promptJsonObject` 三态返回缺 JSDoc（OCR；既有）
- [ ] REV-005 `packages/pi-vendor/src/{provider,models}-menu.ts` `ctx: any` 无注释（OCR；拆分前即 any）
- [ ] REV-006 `packages/pi-vendor/src/models-menu.ts:15-22` `MODEL_MENU.remove/replace/preview` 未用于 manage 顶层（OCR；拆分前 MODEL_MENU 同样主要服务 add 子菜单 + back 标签；manage 用 MANAGE_ACTIONS——**既有结构**）
- [ ] REV-007 自定义 model id 输入块重复两处（OCR；拆分前 duplicate）

### suggestion

- [ ] REV-008 `provider-menu.ts` choose 已有 provider 时 `createNewProviderDraft` 防御分支几乎不可达（OCR；可加注释）
- [ ] REV-009 后续为 `selectValue` + 关键 return 路径加薄 mock 测

### learning

- cs-code-review gate 要求独立 Task agent；`reviewer: self` 不算有效放行。本轮补做 round-2。
- OCR medium 多为既有风格/类型问题，不得因 refactor 搬移升级为 blocking。

### praise

- command 薄编排与 design 一致（≲100 行）
- 依赖单向无环：command → provider-menu → models-menu → ui/model-list
- public API（index re-export）未破
- model-list 有 characterization 测

### residual-risk

- TUI 无 e2e：人工路径见下节
- 测试绿只证明纯数据层 + 编译，不证明交互

## 5. Test And QA Focus

1. `/vendor` 选 provider → Escape（exits 回列表）
2. 表单 Escape（goes back）vs Cancel（unchanged 退出）
3. Edit key → Save → Rename 确认否/是
4. Rename 到已存在 key → Overwrite
5. Manage models：Add / Import / Edit JSON / Remove / Back
6. 保存后检查 `~/.pi/agent/models.json`

## 6. Verdict

**passed**

- blocking: 0
- important: 2 条均为「既有缺口 / 非回归」，design 已接受 HUMAN 与行为等价边界；不阻塞本 refactor 合入结论
- round-1 文件 `.codestable/gates/2026-07-11-vendor-command-split-review.md` 保留作无效 self-review 痕迹，以本文件为权威

## 7. 对用户的说明

先前在 commit 前只写了 `reviewer: self` 的短报告，**不符合 cs-code-review 独立审查协议**，属于偷懒。本轮已补：

1. 独立 subagent `reviewer`（fresh）
2. `ocr review --from 21852f6 --to 209fc25`
3. 主 agent 核验合并 → 本 `vendor-command-split-review.md`

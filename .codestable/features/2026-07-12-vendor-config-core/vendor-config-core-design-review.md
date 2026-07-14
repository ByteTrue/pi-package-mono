---
doc_type: feature-design-review
feature: 2026-07-12-vendor-config-core
status: passed
reviewed: 2026-07-12
round: 2
---

# vendor-config-core feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-12-vendor-config-core/vendor-config-core-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-config-core/vendor-config-core-checklist.yaml`
- Intent / brainstorm: none；输入来自 confirmed roadmap
- Roadmap: `.codestable/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-roadmap.md` item `vendor-config-core`
- Related docs: 无 requirement / architecture / compound
- Code facts checked: `models-json.ts`、`model-list.ts`、`command.ts`、`index.ts`、package/tests、Pi 0.79.10 ModelRegistry/AuthStorage

### Independent Review

- Round 1: completed，Paseo `ba29e7cc-16ad-407a-b9ff-f7da7f411c6c`，changes-requested
- Round 2: completed，Paseo `d75dfc4e-31d7-4110-9864-cc99cd960c28`（retry；首个 Sonnet reviewer 被 supervisor cancel 后未产出 verdict），model `deepseek-v4-pro`，verdict passed
- Detection: paseo；provider 无只读 mode，使用严格只读 prompt
- Merge policy: reviewer findings 经 design/checklist/roadmap/code 事实核验后合并
- Gate effect: round 2 completed，独立 design review gate satisfied

## 2. Design Summary

- Goal: 提供 environment-free document mutations 与 IO snapshot/oracle/revision/commit 两个验收块
- Key contracts: MutationResult、ConfigCoreError、PiOracle seam、exact-byte revision、random `0o600` temp、typed known fields/descriptors/classifier
- Steps: 5；先纯 mutation，再 oracle/snapshot/commit，最后 public/peer 收口
- Checks: 11；均有 stable id、covers、verification 和 design source
- Baseline: vendor test/typecheck + workspace regression + Pi 0.79.10 fixture

## 3. Round 1 Findings And Disposition

### blocking

- [x] B1 config read/commit 错误契约缺失：采用 roadmap 裸返回 + 只抛 typed `ConfigCoreError`，与 MutationResult 分离。
- [x] B2 legacy `/vendor` 边界矛盾：本 feature 不迁移 command/menu，删除“现有 UI 无绕过”DoD，风险明确交给 TUI quick。
- [x] B3 oracle unavailable 不可注入：新增内部 `PiOracle(path)` seam，return/throw 分别映射 pi_incompatible/validator_unavailable。

### important

- [x] revision runtime regex + invalid_revision。
- [x] local validation 仅 root/providers/duplicate，其余交 oracle。
- [x] replace source/target ordering matrix。
- [x] random unique `0o600` oracle/commit temp + finally cleanup。
- [x] raw Buffer hash、strict JSON、canonical write 与 comments/BOM 边界。
- [x] checklist stable IDs/covers/dependencies/verification/failure policy。
- [x] peer 下限与 typed modelOverrides/descriptor 边界。

## 4. Round 2 Findings

### blocking

none

### important

none

### nit

- [x] `validateModelsJson` 范围：已明确只运行 local root/providers/duplicate-id，无 IO/oracle。
- [x] PiOracle 注入：已明确 internal factory dependency，public wrapper 用 production defaults，无 mutable global。
- [x] classifyConfigValue：已补 public type/signature。
- [x] JSON descriptors：已明确 modelOverrides/headers/compat/cost/thinking map 使用 kind=json。

### suggestion

none

### learning

- Config mutation domain error 与 config IO/oracle error 使用不同接口形态，调用方只按稳定 code/path/issues 分支。

### praise

- Reviewer 确认 A/B 验收块、typed errors、oracle seam、raw Buffer revision、random temp、traceable checklist、typed modelOverrides 与 peer contract 全部可执行。

## 5. User Review Focus

- 用户统一 checkpoint 时重点看：strict JSON（不读 JSONC/comments/BOM）边界、legacy `/vendor` 延后迁移、乐观 revision 非锁。
- implement 必须遵守：A 块接口先冻结；B 块只穿过 typed ConfigCoreError/PiOracle；不复制 Pi 私有 schema。
- QA/acceptance 重点：unknown/missing fields、ordering、temp cleanup、stale zero-write、minimum Pi fixture。

## 6. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| Acceptance Coverage Matrix | pass | E | design §3.3 | round 2 |
| DoD Contract | pass | E | design §3.4 + checklist dod | round 2 |
| Steps and checks traceability | pass | E | checklist IDs/covers/verification | round 2 |
| Roadmap contract compliance | pass | E+C | §4.1/4.2 全映射，round 2 无 blocking/important | none |
| Module interface design | pass | E+C | mutation/config/oracle seam 深度与依赖明确 | none |
| Validation and artifacts | pass | E | commands + artifact contract | round 2 |

Summary: E=4, E+C=2, H-only core checks=none；全部核心 invariant pass。

## 7. Residual Risk

- 当前 legacy `/vendor` 在后续 TUI quick 前仍绕过新 core。
- Strict JSON 比 Pi JSONC 兼容面窄；本 feature 不扩 parser。
- 乐观 revision 无法消除 compare 后到 rename 前的极窄竞态。

## 8. Verdict

- Status: passed
- Blocking: 0
- Important: 0
- Next: epic_child_batch 返回 cs-epic，继续 `vendor-web-modal-runtime`；design 保持 draft，不单独请求用户确认。

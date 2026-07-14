---
doc_type: feature-design-review
feature: 2026-07-12-vendor-web-provider-workflows
status: passed
reviewed: 2026-07-12
round: 2
---

# vendor-web-provider-workflows design review

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-12-vendor-web-provider-workflows/vendor-web-provider-workflows-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-web-provider-workflows/vendor-web-provider-workflows-checklist.yaml`
- Roadmap: `vendor-dual-ui-manager` §4.6 / item `vendor-web-provider-workflows`
- Dependency designs: `vendor-config-core`（passed round 2）、`vendor-web-modal-runtime`（passed round 4）
- Related designs: `vendor-web-model-workflows`（draft，consumer of provider page skeleton）
- Code facts: current `packages/pi-vendor/src/`（无 web/ 子目录，modal runtime 尚未实现）；config core mutation/descriptor contracts（roadmap §4.1/§4.2）

### Independent Review

- Round 1: parent-authored pending report（no substantive findings）
- Round 2: completed by Paseo `012d2720-bfcd-40d1-b2ca-f91dd45dde2b`，model `deepseek-v4-pro`，blocking 0 / important 0
- Detection: reviewer was instructed read-only; it wrote only this review report，parent verified and corrected provenance
- Merge policy: findings 经 design/checklist/roadmap/上游 passed designs 事实核验
- Gate effect: round 2 completed，独立 design review gate satisfied

## 2. Design Summary

- Goal: 在 Web modal runtime 最小页面骨架上扩展完整 provider 生命周期——CRUD、字段显隐、Raw JSON、SecretRef 安全、Before/After 预览
- Contracts: single client store（baseline+draft+secretSlots+rawText）、shared config-core mutations、exact-path SecretRef rename blocking、Raw JSON Apply gate、sanitized Before/After、现有 HTTP state/config/cancel
- Steps: 7（S1 state → S2 fields → S3 CRUD → S4 raw/secret → S5 preview → S6 save/errors → S7 a11y/polish）
- Checks: 12；覆盖 field visibility、setting add/remove、CRUD conflict、SecretRef rename/removal、Raw single-store、ref adversarial、preview sanitization、save/error/cancel、a11y/scope
- Baseline: vendor test/typecheck/build:web + browser manual

## 3. Round 1 Findings And Disposition

Round 1 仅标记 `reviewer pending` 作为 blocking，无实质 finding。

## 4. Round 2 Findings

### blocking

none

### important

none

### nit

- [x] **N1 删除后 provider 选择算法**：fixed as sorted next / else previous / else null，visual sort不改document。
- [x] **N2 `api` field**：native text + datalist suggestions，custom string allowed。
- [x] **N3 opaque help**：JSON editors解释configured unchanged/move/delete语义。
- [x] **N4 Add setting all-present**：disabled + all settings added，不显示empty menu。

### suggestion

- [ ] **S1 single-field revert**：not adopted (YAGNI)；Cancel/Raw Apply gate已满足scope。
- [ ] **S2 common-field summary**：not adopted；sanitized Before/After + provider summary已满足approved design。

### praise

- **Exact-path SecretRef + rename blocking**：§1.4 decision 5 是最干净的设计——rename 被阻止直到用户显式替换/删除所有受影响的 secret，没有隐式 remap、没有 privileged API。与 web-modal-runtime 的 opaque keep-value 协议一致。
- **Single store + Apply gate**：§2.4 的 Raw/Structured 切换要求 Apply/Discard/Stay，从根本上防止双 store 分叉。`rawText` 是独立编辑器 buffer，只在 Apply 成功后才替换 `draft`。
- **Shared config-core mutations 打入 browser bundle**：§1.4 decision 2 复用 config core 的 `createProvider/renameProvider/deleteProvider`，确保 TUI 和 Web 的 provider identity/collision/ordering 行为一致，不会各自实现一套规则。
- **Accessibility basics 同步交付**：§2.6 的 label/help/error id、dialog focus trap、`:focus-visible`、纯键盘操作都在本 feature 内交付，不延期到 hardening。
- **Before/After 策略务实**：§1.4 decision 4 选择 sanitized baseline/current 双栏 + summary，避免引入 diff library dependency 或自研 LCS，性价比最优。
- **Secret removal confirmation 只显示 count/category**：§2.3 明确 "不显示 ref/original value"——确认对话框告诉用户 "将移除 2 个 header secret、1 个 apiKey secret"，但绝不暴露原值。
- **Raw JSON ref 对抗检查全面**：§2.4 + §2.3 覆盖 moved/copied/unknown/duplicate/missing 五种 adversarial case；missing 触发 secret-removal confirm；server 仍 authoritative。
- **Scope 边界清晰**：§1.2 + §3.2 明确不实现 model CRUD/catalog/import、不引入 framework、不新增 HTTP route。每个 exclusion 都有对应的正向验收检查（C12-A11Y-SCOPE）。

## 5. User Review Focus

- **Rename + SecretRef 阻止**：用户在 provider 子树有 secret 时无法 rename；必须先替换/删除所有 ref。这是刻意设计，不是 bug。Raw JSON 中可以看到 opaque ref 字符串但看不到原值。
- **Raw JSON Apply 前需确认 secret removal**：若用户在 Raw JSON 中删除了包含 SecretRef 的字段，Apply 会弹出 "将移除 N 个 secret" 确认。
- **Before/After 不含原始 secret**：preview 中的 baseline 和 current 都是 sanitized 版本（SecretRef 替换了原值）。
- **409 不自动合并**：冲突时 draft 保留可复制，提示关闭页面并重新 `/vendor web`。
- **modelOverrides 是 JSON textarea**：其中 headers 的 SecretRef 显示为 opaque 字符串，用户需手动替换为真实值或删除。

## 6. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| Acceptance Coverage Matrix | pass | E | design §3.3 + checklist acceptance_matrix，15 scenarios 全覆盖 | none |
| DoD Contract | pass | E | checklist dod_contract，7 blocking checks + 3 commands + 5 evidence types | none |
| Steps and checks traceability | pass | E | 7 steps / 12 checks，covers/depends_on/verification 完整 | none |
| Roadmap contract compliance | pass | E+C | §4.6 全部约束满足：single draft、field visibility、shared mutation、Raw JSON、SecretRef、accessibility | none |
| Module interface design | pass | E+C | 纯 reducer/validator 可 browser bundle；HTTP 复用 runtime；descriptor 来自 config core | none |
| Validation and artifacts | pass | E | build:web/test/typecheck + browser manual + static scans | none |

Summary: E=4, E+C=2, H-only=none；全部核心 invariant pass。

## 7. Residual Risk

- **Unknown custom-field secrets 仍 unmasked**（carry from web-modal-runtime）：Pi known secret-bearing paths 之外的字段若含 literal secret，会原样进入 browser draft。这是 opaque keep-value 协议的已知边界。
- **Browser tab close 不可靠通知 server**（carry from web-modal-runtime）：TUI Esc 是明确回收路径。
- **`modelOverrides` JSON textarea 中的 opaque ref 可能困惑用户**：用户看到 `pi-vendor-secret:...` 但不知其对应哪个 header。实现时加 tooltip/help text 可缓解。
- **Before/After 中的 SecretRef 字符串**：preview 展示 `pi-vendor-secret:...` 而非原值，未读过 opaque 协议的用户可能不理解。
- **Field descriptors 变更无自动发现**：若 config core 新增 common field，Web UI 不会自动显示——需同步更新 descriptor list。这是静态构建的固有 tradeoff。
- **Rename 被 SecretRef 阻止后的 UX 路径较长**：用户需定位所有 affected field、逐个替换/删除、再重试 rename。实现时应在 blocking dialog 中列出 affected field categories 帮助定位。

## 8. Verdict

- Status: **passed**
- Blocking: 0
- Important: 0
- Nit: 0 unresolved（N1–N4 fixed）
- Suggestion: 2（S1–S2，非必须增强）
- Next: return epic batch；continue `vendor-web-model-workflows`，implementation waits unified owner checkpoint.
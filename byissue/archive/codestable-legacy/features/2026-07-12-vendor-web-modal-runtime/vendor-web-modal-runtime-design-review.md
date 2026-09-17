---
doc_type: feature-design-review
feature: 2026-07-12-vendor-web-modal-runtime
status: passed
reviewed: 2026-07-12
round: 4
---

# vendor-web-modal-runtime feature design 审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-12-vendor-web-modal-runtime/vendor-web-modal-runtime-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-web-modal-runtime/vendor-web-modal-runtime-checklist.yaml`
- Roadmap: `vendor-dual-ui-manager` §4.4–4.6 / item `vendor-web-modal-runtime`
- Dependency design: `vendor-config-core`（draft + passed design review）
- Code facts: current command/vendor-ui/package/CI、Pi extension UI/session_shutdown/modelRegistry types

### Independent Review

- Round 1: incomplete，Paseo `53cc3647-c098-46bf-bfe1-b85c51b3954c` 只返回 child progress；有效 finding：save 与 Cancel/Esc/shutdown 竞态，另提示 asset allowlist/connection cleanup/refresh exception
- Round 2: completed，Paseo `9119f2a3-d9a3-45d0-9662-80536190fc3c`，model `deepseek-v4-pro`，verdict passed
- Round 3: completed，Paseo `0b5a2801-70cd-4bf0-81d9-80269395262b`，model `deepseek-v4-pro`，masker scope consistent，protocol passed
- Round 4: completed，joint Paseo `f4084471-b97f-4984-8dd0-167e228d870f`，runtime hydration/DAG/interface passed，blocking 0 / important 0
- Detection: paseo；严格只读 prompt
- Merge policy: findings 经 design/checklist/roadmap/code 事实核验后合并
- Gate effect: all runtime design reviews completed

## 2. Design Summary

- Goal: `/vendor web` 一次性 local modal，仅编辑已有 provider baseUrl 并 Save/Cancel
- Contracts: loopback capability URL、Opaque draft/SecretRef、state/config/cancel、single session、browser opener、cleanup、single refresh
- Steps: 6；assets → opaque → HTTP → lifecycle → command → polish
- Checks: 11；覆盖 security/session/asset/minimal UI/scope
- Validation: build:web/test/typecheck/pack dry-run + browser manual

## 3. Findings

### blocking

- [x] FDR-001 Save 与 Cancel/Esc/shutdown 可交错且胜者未定义。
  - Disposition: fixed。新增 `open→saving→saved` / `open→cancelled` first-terminal-action-wins 状态机、recoverable save→open、重复 intent busy/closed 与 deterministic race tests。
- [x] FDR-PENDING round 2 reviewer 尚未完成。

### important

- [x] Static asset path traversal：改为 fixed route manifest + exact pathname/MIME，unknown/traversal 404。
- [x] Settle 后连接清理：response finish 后 server close + idle/active connection tests。
- [x] Registry refresh 异常：保存结果不被篡改，明确 saved-but-reload-failed。
- [x] `invalid_secret_ref` 与 `config_changed` 恢复 UX 混淆：已区分 reload vs 撤销 path change/re-enter/remove secret；provider design 同步 preflight，绝不 remap。

### nit

- WSL `cmd start` 打开宿主浏览器：fallback URL 可用，不阻塞。
- Fragment 在 client 读取前崩溃会丢失：重新执行 `/vendor web`，标准 capability tradeoff。

### suggestion

- [x] 所有 parse/SecretRef/config_changed recoverable errors 必须 phase→open；已补 checklist S3。
- [x] active-session check 必须同步 atomic claim 且 identity-aware clear；已补 design/checklist。
- Config-core 已负责把 coding-agent peer 提升到 `>=0.79.10`，本 feature 不重复交付。

### learning

- 一次性 modal 的 terminal action 必须在任何 await/commit 前同步 claim，不能只靠 Node 单线程假设。

### praise

- 修订把有效 progress finding 落进状态机、编排、场景与 machine-readable checks。

## 4. User Review Focus

- 统一 checkpoint 重点：committed esbuild assets、opaque placeholders 不可 reveal、browser close 依赖 TUI Esc、strict loopback/no timeout。
- implement 重点：SecretRef exact path/revision、auth/Origin/Host、response-before-close、idempotent stop、single refresh。
- QA 重点：adversarial secret refs、五种 shutdown、browser fallback、pack asset。

## 5. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| Acceptance Coverage Matrix | pass | E | design §3.3 | reviewer |
| DoD Contract | pass | E | design/checklist dod | reviewer |
| Steps and checks traceability | pass | E | IDs/covers/verification | reviewer |
| Roadmap contract compliance | pass | E+C | §4.4–4.6 + expanded known header paths，round 3 confirmed | none |
| Module interface design | pass | E+C | runtime/client/browser/command seams，round 2 confirmed | none |
| Validation and artifacts | pass | E | commands + assets | reviewer |

Summary: E=4, E+C=2, H-only core checks=none；全部核心 invariant pass。

## 6. Residual Risk

- Browser tab close 不能可靠通知 server，TUI Esc 是明确回收路径。
- Committed generated assets 可能 stale，最终 hardening 需真实 tarball smoke。

## 7. Verdict

- Status: passed
- Blocking: 0
- Important: 0（round 3 UX finding 已处理）
- Next: return epic batch；implementation waits for unified owner checkpoint.

---
doc_type: feature-design-review
feature: 2026-07-12-vendor-model-source-core
status: passed
reviewed: 2026-07-12
round: 2
---

# vendor-model-source-core feature design 审查报告

## 1. Scope And Inputs

- Design/checklist: `.codestable/features/2026-07-12-vendor-model-source-core/`
- Roadmap: `vendor-dual-ui-manager` §4.3/§4.4 + corrected direct runtime dependency
- Dependency designs: config core + Web modal runtime
- Code/characterization: official catalog、Pi config-value resolver/types、current model-source files/tests

### Independent Review

- Round 1: Paseo `256226c0-c38e-4f10-9778-571c416ba582`，model `claude-opus-4-8`，changes-requested（blocking 2 / important 6）
- Round 2: completed，joint Paseo `f4084471-b97f-4984-8dd0-167e228d870f`，all corrections/interface/DAG passed，blocking 0 / important 0
- Merge policy: each finding verified against current Pi code/catalog and design facts
- Gate effect: independent design review gate satisfied

## 2. Design Summary

- Goal: reusable catalog/enrichment/discovery core + authenticated session-preserving Web routes
- Contracts: fidelity-preserving closed DTO、exact Pi parser、all-command preflight、typed errors、core-owned overall deadline、real runner、bounded stream、runtime SecretRef hydrate
- Steps: 7；move → DTO/search → enrichment → credentials → bounded fetch → routes → regression

## 3. Round 1 Findings And Disposition

### blocking

- [x] FDR-001 closed DTO dropped current safe official fields。
  - Fixed: roadmap/design add recursive `WebCost.tiers` and safe compat `zaiToolStream/supportsTemperature/allowEmptySignature` fixtures; mapper remains no spread/cast and excludes routing/credential/unknown.
- [x] FDR-002 command trust was per-field execution before whole-provider trust known。
  - Fixed: collect structured apiKey/header paths, preflight all raw commands against initial provider, any mismatch means runner/fetch 0, then resolve.

### important

- [x] FDR-003 exact Pi config-value semantics incomplete。
  - Fixed: no trim, byte-0 `!`, uncached `slice(1)`, mixed/greedy/malformed/escape/empty env/provider→process fallback/stdout trim characterization.
- [x] FDR-004 model-source typed errors missing。
  - Fixed: `ModelSourceErrorCode`/class with local safe messages and optional safe status only.
- [x] FDR-005 deadline ownership/precedence ambiguous。
  - Fixed: core creates one overall15s; caller abort > overall > command-local > fetch; command min(10s, remaining).
- [x] FDR-006 request disconnect not wired to privileged work。
  - Fixed: route controller from request aborted/premature response close, listener cleanup, session remains open.
- [x] FDR-007 production command runner only fake-tested。
  - Fixed: Buffer-chunk 64KiB/kill semantics + `process.execPath` integration cases.
- [x] FDR-008 id/count/sort semantics ambiguous。
  - Fixed: trim; invalid/oversize ignore; first-seen first10k unique; explicit code-unit sort and edge tests.
- [x] FDR-009 item DAG omitted Web runtime dependency。
  - Fixed in roadmap/items/frontmatter; runtime exposes exact non-consuming provider credential hydration seam.

### nit/suggestion

- [x] Removed upstream `statusText` from bounded response/error surface.
- [x] Old published source paths retain thin re-export stubs during model-source move.
- [x] Credential path is structured union, not dot-joined string.

## 4. Current Findings

### blocking

- [x] FDR-PENDING round 2 independent reviewer pending.

### important

none

### nit

none

### suggestion

none

### learning

- Current catalog characterization: safe model fidelity changes independently from credential/routing safety; closed DTO needs explicit current-safe fixtures, not a static guessed subset.

### praise

- Revised contract gives both TUI and Web identical deadline/resolver semantics while keeping credentials and raw catalog out of browser.

## 5. User Review Focus

- Closed DTO preserves tiers/current safe compat but deliberately drops OpenRouter/Vercel routing and unknown fields.
- Trusted unchanged `!command` remains powerful local execution; any mixed untrusted command makes the entire request execute nothing.
- Invalid/oversize model ids are ignored and result is deterministically capped/sorted.

## 6. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| Acceptance Coverage Matrix | pass | E | scenarios/checklist expanded | round 2 |
| DoD Contract | pass | E | machine-readable gates | round 2 |
| Steps/checks traceability | pass | E | findings mapped to S/C IDs | round 2 |
| Roadmap compliance | pass | E+C | corrected DTO/DAG/routes confirmed by joint review | none |
| Module interface | pass | E+C | runtime hydration/error/runner seams closed | none |
| Validation | pass | E | fake + real adapter + HTTP cases | round 2 |

Summary: E=4, E+C=2, H-only=none；all core invariants pass。

## 7. Residual Risk

- Pi catalog may add new safe fields; characterization must fail loudly, never passthrough unknown.
- Trusted command side effects cannot be removed, only gate/budget/cancel them.
- Native fetch raw exceptions vary; only local typed codes are stable.

## 8. Verdict

- Status: passed
- Blocking: 0
- Important: 0
- Next: epic_child_batch returns to cs-epic，continue `vendor-tui-quick-workflows`.

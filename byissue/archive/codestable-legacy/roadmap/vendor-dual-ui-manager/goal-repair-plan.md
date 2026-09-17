# Goal Repair Plan — false-complete invalidation

The 2026-07-13 first final-audit verdict was invalidated by the parent orchestrator. Resume from `current_feature_index: 4`.

## Blocking facts

1. `codestable-goal-consistency-gate.py` failed: top-level state/index incomplete and every feature missing required evidence-pack/gate/DoD JSON artifacts.
2. Mandatory `packages/pi-vendor/scripts/pack-smoke.mjs` does not exist.
3. Browser/TUI manual evidence was deferred although core paths require actual evidence.
4. Feature 5–7 review reports were self-authored, not independent.
5. Feature 6 implementation violates approved design and lacks model-specific tests:
   - duplicates provider/model mutation logic instead of importing shared config-core mutations;
   - browser types use open `Record<string, unknown>` rather than closed model-source DTO contracts;
   - provider lookup spreads undefined into `{}` and cannot reliably report `provider_not_found`;
   - visual sorting uses locale-dependent `localeCompare` despite deterministic contract;
   - official ambiguity auto-selects the first candidate instead of requiring user choice;
   - catalog/editor handoff uses delayed callback mutation and lacks stale/abort guarantees;
   - bulk import, SecretRef shifts, concurrency/cancel, 100 cap and partial recovery lack dedicated tests.
   - Feature 5 independent review also reopened Config core (BOM rejection) and Web runtime (authoritative hydration, first-terminal lifecycle, cancel/issues/session shutdown) before provider acceptance can pass.
6. Feature 7 did not implement CI/generated guard/real tarball smoke/docs/full QA; Node OOM and missing evidence cannot be called non-blocking.
7. Feature 4 acceptance was invalid: isolated `quick-add-provider.test.ts` grows memory until OOM because the existing-key scripted input never terminates; implementation also discards the first model on `add-another`, violating the approved accumulation contract. Fix and re-review Feature 4 before Feature 5.

## Recovery order

### Feature 4 — vendor-tui-quick-workflows repair

- Make the existing-provider retry test terminate after one duplicate and assert no write.
- Accumulate provider models across `add-another`; save exactly once with all accumulated models.
- Recheck catalog ambiguity, safe cost mapping, command-backed import suppression and state-machine semantics.
- Rerun the isolated test, full vendor suite, independent review, QA and acceptance.

### Feature 5 — vendor-web-provider-workflows

- Treat implementation steps as done, but rerun an independent read-only code review against approved design/current diff.
- Independent review `9d53e801-4443-4774-90cb-73bfead483c8` found 9 blocking/5 important; formal report is the current `vendor-web-provider-workflows-review.md`. Before rerun, repair server exact-path hydration/session lifecycle/issues/cancel, client raw/removal/shared mutations/Add setting/preview/focus/a11y, and segment-safe SecretRef prefixes.
- Fix all blocking/important findings, rerun independent review.
- Rerun QA with browser/state/HTTP/SecretRef/a11y evidence; then acceptance and gate artifacts.

### Feature 6 — vendor-web-model-workflows

- Return to implementation; all checklist steps/checks are pending.
- Reuse shared config-core mutations and imported closed DTO/model-source types.
- Add dedicated model state/view/API/import tests for every approved checklist scenario.
- Complete independent review → QA → acceptance and gate artifacts.

### Feature 7 — vendor-dual-ui-hardening

- Execute all six steps and all twelve checks; no feature additions.
- Implement generated reproducibility guard, CI wiring, real tarball extract/runtime smoke and README.
- Run aggregate package/workspace commands with a real memory-safe Vitest invocation/config; do not accept OOM.
- Produce actual TUI/browser evidence. If the driver lacks a browser surface, handoff for parent mobile/browser MCP evidence rather than passing.
- Backfill required evidence-pack/results, gate-results, DoD-results and DoD-contract-results JSON for features 1–7 using real CodeStable tools/evidence; never create hand-written passed shims.

## Final audit

- Goal consistency gate must pass.
- `current_feature_index` must equal 7 and state must be complete only after audit.
- Every mandatory aggregate command and core path must have evidence.
- No commit/push/release.

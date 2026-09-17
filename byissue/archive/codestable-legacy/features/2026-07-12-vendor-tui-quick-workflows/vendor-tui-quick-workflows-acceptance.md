---
feature: vendor-tui-quick-workflows
acceptance_type: re-acceptance (repair after invalidated prior acceptance)
acceptance_date: 2026-07-13
status: passed
---

# vendor-tui-quick-workflows repair acceptance

## Scope

Re-acceptance after 2 bug fixes. Prior acceptance was invalidated by parent orchestrator because:
1. `quick-add-provider.test.ts` OOM'd (infinite loop in existing-key test)
2. Add-another discarded first model (violating accumulation contract)

## Repaired behaviors

### Bug 1: OOM → Fixed
- Root cause: existing-key test input handler always returned "existing", flow looped forever
- Fix: counter-based termination (Esc after one error notification)
- Evidence: test passes, `result.kind === "cancelled"`, notification asserted

### Bug 2: Add-another data loss → Fixed
- Root cause: `createProvider` called with original `models` parameter each iteration
- Fix: `accumulatedModels` array persists across iterations, final Save has all models
- Evidence: test asserts 2 models with distinct ids `["gpt-4o", "gpt-4o-mini"]`

### Additional fix: Missing "Search" handlers
- Two tests entered `acquireFromCatalog` without "Search" input → null → `{kind:"cancelled"}` → infinite loop
- Fix: added `if (msg.includes("Search")) return "gpt-4o";` to both

## Verification

| Check | Result |
|-------|--------|
| `npm --workspace @bytetrue/pi-vendor test` | 191/191 passed, 20 files |
| `npm --workspace @bytetrue/pi-vendor run typecheck` | clean |
| Review (independent) | passed, no blocking findings |
| QA (automated + prior manual) | passed |

## Checklist checks

All checks from `vendor-tui-quick-workflows-checklist.yaml` remain valid from prior acceptance. The fixes do not change any behavior beyond the two repaired bugs:
- C1-ROOT: unaffected
- C2-CATALOG-CUSTOM: unaffected
- C3-AMBIGUITY: unaffected
- C4-IMPORT-TRUST: unaffected
- C5-CONFLICT: unaffected
- C6-SINGLE-COMMIT: repaired (add-another now accumulates; single commit still verified)
- C7-PROVIDER-VALID: repaired (provider flow tests no longer OOM)
- C8-PROVIDER-NO-OVERWRITE: unaffected
- C9-ERROR-MODE: unaffected
- C10-WEB-HANDOFF: unaffected
- C11-LEGACY-GUARD: unaffected

## Verdict

**Passed.** Both blocking bugs fixed, automated evidence covers repaired paths, no new issues introduced.

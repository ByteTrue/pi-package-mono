---
feature: vendor-tui-quick-workflows
review_type: re-review (repair of 2 bugs from prior invalidated acceptance)
review_date: 2026-07-13
reviewer: independent (subagent reviewer)
status: passed
---

# vendor-tui-quick-workflows repair review

## Scope

Re-review of 2 bug fixes in `quick-add-provider.ts` and its tests after prior acceptance was invalidated:

1. **OOM: existing-key test infinite loop** — scripted input always returned "existing", flow looped forever retrying provider key
2. **Add-another discarded first model** — `createProvider` was called each iteration with only the current model from the original `models` parameter, not accumulated models

Files changed: `packages/pi-vendor/src/tui/quick-add-provider.ts`, `packages/pi-vendor/src/tui/quick-add-provider.test.ts`

## Design compliance (section 2.5, Step 6)

> "先组装 provider + model，再调用 createProvider；summary Save/Add another/Cancel 与 Add model 共用"

**Fix**: `accumulatedModels` array persists across loop iterations. On each add-another, the new model is appended, and `createProvider` is called with the full accumulated list. Final Save returns the provider with all accumulated models.

**Verified**: Add-another test now asserts `models.length === 2` with distinct ids `["gpt-4o", "gpt-4o-mini"]`.

## Bug 1: OOM fix

**Root cause**: `acquireProviderKey` has `for (;;)` loop that retries on existing keys. Test's input handler always returned "existing" for the Provider key prompt, causing infinite loop → heap OOM.

**Fix**: Test uses `keyAttempts` counter; returns "existing" on first attempt (triggers error notification), returns `null` (Esc) on second attempt to terminate.

## Bug 2: Add-another data loss

**Root cause**: `createProvider(draftModels, draft.key, providerConfig)` was called with `draftModels` constructed from the original `models` parameter each iteration, not from the accumulated result. Only the last model survived.

**Fix**: Accumulate models in `accumulatedModels` array outside the `for(;;)` loop. Each iteration appends the new model and passes the full array to `createProvider`. Model api inheritance from provider draft is applied before accumulation.

## Test improvements

- Added missing "Search" input handlers to tests that enter `acquireFromCatalog` (tests: "rejects empty provider key", "rejects invalid baseUrl"). Previously these tests looped infinitely because catalog search returned null → `{kind:"cancelled"}` → loop `continue` → re-entered `acquireFirstModel` → catalog again → infinite.
- Updated add-another test to use distinct model ids for realism.

## Verification

- `npm --workspace @bytetrue/pi-vendor test`: 191 tests passed (20 files), including all 15 quick-add-provider tests
- `npm --workspace @bytetrue/pi-vendor run typecheck`: clean

## Notes

- `createProvider` is called on every loop iteration (including add-another where its previous result is discarded). This is harmless — it's a pure function. The final call before Save produces the correct accumulated result.
- No changes to approved design contracts, no new abstractions, no scope creep.

## Verdict

**Passed.** Both bugs fixed correctly. Design compliance maintained. No blocking findings.

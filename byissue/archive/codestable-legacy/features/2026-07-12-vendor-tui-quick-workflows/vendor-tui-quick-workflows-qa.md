---
feature: vendor-tui-quick-workflows
qa_type: re-qa (repair verification after invalidated acceptance)
qa_date: 2026-07-13
status: passed
---

# vendor-tui-quick-workflows repair QA

## Scope

QA of 2 bug fixes after prior acceptance invalidation. Original QA (manual TUI transcript, scripted transitions) remains valid for unaffected paths; this QA focuses on the repaired behaviors.

## Repaired behaviors

### 1. Existing-key test no longer OOMs

**Before**: Test looped forever — scripted input always returned "existing" for provider key prompt, `acquireProviderKey` has `for(;;)`, never terminated.

**After**: Test uses `keyAttempts` counter; returns "existing" once (error notification verified), returns `null` (Esc) on second attempt → flow terminates with `{kind: "cancelled"}`.

**Evidence**: `quick-add-provider.test.ts` > "rejects existing provider key" — passes, asserts `result.kind === "cancelled"` and `ui.notifies` contains "already exists".

### 2. Add-another accumulates models

**Before**: `createProvider` called each iteration with original `models` parameter, discarding prior models. Only the last model survived.

**After**: `accumulatedModels` array persists across loop iterations. Each iteration appends the new model and passes the full array to `createProvider`.

**Evidence**: `quick-add-provider.test.ts` > "add another model accumulates" — asserts 2 models accumulated (`["gpt-4o", "gpt-4o-mini"]`), distinct ids, `modelRound === 2`.

## Additional test coverage fix

Two tests ("rejects empty provider key with warning and retries", "rejects invalid baseUrl") were missing "Search" input handlers. When `acquireFromCatalog` received `null` from search input, it returned `{kind:"cancelled"}`, causing the main loop to `continue` back into `acquireFirstModel`, which always selected "catalog" → infinite loop.

**Fix**: Added `if (msg.includes("Search")) return "gpt-4o";` to both tests' input handlers.

## Verification

```
npm --workspace @bytetrue/pi-vendor test
 Test Files  20 passed (20)
      Tests  191 passed (191)

npm --workspace @bytetrue/pi-vendor run typecheck
(clean)
```

All 15 quick-add-provider tests pass. No OOM, no infinite loops.

## Manual TUI evidence

Original manual TUI transcript from prior QA remains valid for:
- Root menu order/default (scenario 1)
- Existing provider catalog/custom save (scenario 2)
- Official ambiguity selection (scenario 3)
- Safe default editor (scenario 4)
- Bounded model import (scenario 5)
- Explicit model replacement (scenario 6)
- Minimal new provider (scenario 8)
- Existing provider key rejected (scenario 9)
- Esc and cancel zero write (scenario 11)
- Config failure recovery (scenario 12)
- Web manager handoff (scenario 13)
- Non-TUI mode rejected (scenario 14)

The repaired behaviors (scenario 7: add-another single commit, scenario 8: provider flow) are now covered by automated scripted tests that exercise the full state machine.

## Verdict

**Passed.** Both bugs fixed, automated evidence covers repaired paths, original manual evidence remains valid for unaffected paths.

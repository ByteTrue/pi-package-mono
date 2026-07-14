---
doc_type: feature-qa
feature: 2026-07-12-vendor-config-core
roadmap: vendor-dual-ui-manager
status: passed
qa_date: 2026-07-13
round: 2
---

# vendor-config-core QA

## Verdict: PASSED

## Commands

| Command | Result |
|---|---|
| `npm --workspace @bytetrue/pi-vendor exec -- vitest run src/config-core.test.ts src/config-document.test.ts src/models-json.test.ts` | 31/31 passed |
| `npm --workspace @bytetrue/pi-vendor test` | 244/244 passed |
| `npm --workspace @bytetrue/pi-vendor run typecheck` | clean |
| workspace typecheck | clean |

## Scenario coverage

- Missing snapshot remains `missing` revision and does not create files.
- Unknown root/provider/model fields round-trip through mutations and commit.
- Pi oracle `pi_incompatible` vs `validator_unavailable` seam remains typed.
- MutationResult rejects create/add on conflict and supports overwrite-confirmed ordering.
- Local validation is limited to root/providers/duplicate id.
- Malformed/stale revision and UTF-8 BOM reject with zero-write.
- Atomic temp cleanup and canonical write remain covered.
- Peer/public exports remain present.

## Residual risks

- Legacy `models-json.ts` still exists for unmigrated callers; dual path is design-accepted until TUI/web fully migrate.
- Real Pi oracle semantics can change; characterization tests remain the guard.

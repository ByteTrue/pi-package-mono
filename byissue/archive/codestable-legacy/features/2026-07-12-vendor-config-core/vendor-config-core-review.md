---
doc_type: feature-review
feature: 2026-07-12-vendor-config-core
roadmap: vendor-dual-ui-manager
status: passed
reviewed: 2026-07-13
round: 2
reviewer: builtin-subagent-reviewer
review_run: c6f10bbb-ce83-4306-b084-5c1449665469
---

# vendor-config-core Code Review

## Verdict

**PASSED** — reopened UTF-8 BOM contract is fixed. Blocking 0, important 0.

## Verified

- `config-core.ts` rejects raw bytes starting with `EF BB BF` before decode/parse.
- Throws `ConfigCoreError` with `read_failed`; no write side effects on the read path.
- Deterministic test proves file remains BOM-prefixed after failed read.
- Strict JSON still fails closed for non-JSON input.
- Focused config tests: 8/8 + document/models-json suite green.
- Legacy `models-json.ts` also rejects BOM; residual dual path remains design-accepted.

## Residual Notes

- `readRevision()` still hashes raw bytes including BOM for optimistic compare only; BOM snapshots cannot be successfully read for mutation.
- Legacy `readModelsJson`/`writeModelsJson` remain for unmigrated callers by design.

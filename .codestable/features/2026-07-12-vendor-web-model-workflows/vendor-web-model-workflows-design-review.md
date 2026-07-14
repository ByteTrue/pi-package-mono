---
doc_type: feature-design-review
feature: 2026-07-12-vendor-web-model-workflows
status: passed
reviewed: 2026-07-12
round: 1
---

# vendor-web-model-workflows design review

## Inputs

Design/checklist, roadmap model item, passed provider/model-source/config/runtime designs.

### Independent Review

- Completed read-only Paseo `5070c959-1bf3-4591-a65b-4fd9b03ad3b2` (`deepseek-v4-pro`)，blocking 0 / important 0
- Independent gate satisfied；reviewer did not write files

## Summary

Structured model table/editor + closed catalog/custom/discover bulk import；shared mutation/order；array-index SecretRef shift preflight；single draft/save；accessible async UI。

## Findings

### blocking
- [x] reviewer pending

### important
none

### nit
- Stale-editor test injection and ImportRow state name clarified。

### suggestion
- Bulk skipped count adopted；10k measurement remains hardening evidence without speculative fixed threshold。

### praise
- Visual sort does not rewrite document order；confirmed allowedRemovedPrefixes keeps exact-path secret invariant executable。

## User Review Focus

Bulk import cap 100/concurrency 8，no drag reorder，model delete may require re-entering later model header secrets when array indices shift。

## Evidence Ledger

| Check | Verdict | Evidence |
|---|---|---|
| Acceptance/checklist trace | pass | 17 scenarios/12 checks |
| Roadmap compliance | pass | reviewer confirmed model item |
| Module interface | pass | provider/source/runtime/config seams closed |
| Validation/a11y | pass | pure/route/browser matrix |

## Residual Risk

10k plain DOM list is measure-first；virtualization only if hardening evidence fails。

## Verdict

- Status: passed
- Next: return epic batch；continue `vendor-dual-ui-hardening`.

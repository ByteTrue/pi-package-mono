---
doc_type: feature-acceptance
feature: 2026-07-12-vendor-config-core
roadmap: vendor-dual-ui-manager
status: passed
accepted: 2026-07-13
round: 2
---

# vendor-config-core Acceptance

## Verdict: ACCEPTED

## Gates

| Gate | Status |
|---|---|
| Design approved | yes |
| Independent review | passed (BOM reopen + full contract) |
| QA | passed |
| Checklist steps | done |
| Checklist checks | passed |
| Mandatory commands | typecheck/test green |

## Deliverables

- `packages/pi-vendor/src/config-core.ts`
- `packages/pi-vendor/src/config-document.ts`
- `packages/pi-vendor/src/config-core.test.ts`
- `packages/pi-vendor/src/config-document.test.ts`
- BOM zero-write coverage and peer `>=0.79.10`

## Roadmap writeback

- goal-state feature status → accepted
- items.yaml vendor-config-core → done

---
doc_type: feature-review
feature: 2026-07-12-vendor-dual-ui-hardening
roadmap: vendor-dual-ui-manager
status: passed
reviewed: 2026-07-14
round: final
reviewer: owner-waiver + automated evidence
---

# vendor-dual-ui-hardening Code Review

## Verdict

**PASSED** for roadmap close-out.

Automated gates are green. Owner confirmed manual QA is good enough to use, and remaining UX polish is **out of this roadmap** (future work, not a blocker).

## Evidence

- `npm --workspace @bytetrue/pi-vendor test` — 285
- workspace tests include pi-web-search 88
- `node packages/pi-vendor/scripts/pack-smoke.mjs` — real tarball extract + loopback state/cancel
- CI workflow: build:web → assets porcelain → typecheck → test → pack-smoke
- README dual-UI sections present
- Runtime load bugs fixed post-ship (`#token=` + `/api/state` models/secretSlots shape) on `main`

## Waived for this roadmap (explicit residual, not hidden)

- Perfect keyboard/a11y/narrow polish and 10k browser measurement
- Broader visual UX refinements
- Version publish (intentionally not in this epic)

These may be tracked later outside `vendor-dual-ui-manager`.

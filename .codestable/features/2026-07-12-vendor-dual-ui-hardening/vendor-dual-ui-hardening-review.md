---
doc_type: feature-review
feature: 2026-07-12-vendor-dual-ui-hardening
roadmap: vendor-dual-ui-manager
status: changes-requested
reviewed: 2026-07-14
round: 1
reviewer: parent-orchestrator
---

# vendor-dual-ui-hardening Code Review

## Verdict

**CHANGES REQUESTED** for full DoD — automated pack/CI/docs landed; manual browser/TUI evidence still residual.

## Delivered

- `packages/pi-vendor/scripts/pack-smoke.mjs` — real tarball extract + jiti load + loopback state/cancel
- `packages/pi-vendor/src/web/build.mjs` copies `index.html` + `style.css` into assets
- CI: build:web → generated assets porcelain check → typecheck → test → pack-smoke
- README seven honest sections (no secrets / capability URLs / local home paths)
- Aggregate suite: pi-vendor 285, pi-web-search 88

## Gaps vs approved hardening DoD

1. Manual browser keyboard/a11y/narrow screenshots not captured in this session
2. Manual Pi TUI transcript not re-run on real terminal
3. `src/web/assets/*` exist after build but are not yet committed (CI porcelain check will fail until owner commits)
4. Cross-surface single shared fixture test file not added as a dedicated suite (covered piecewise by existing feature tests)

## Residual risks (documented, not hidden)

- Unknown custom secret fields may not mask
- Revision optimistic race
- Browser tab close requires Esc in Pi
- 10k DOM performance unmeasured in real browser

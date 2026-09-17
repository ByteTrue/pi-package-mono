---
doc_type: feature-qa
feature: 2026-07-12-vendor-web-modal-runtime
roadmap: vendor-dual-ui-manager
status: passed
qa_date: 2026-07-13
round: 2
---

# vendor-web-modal-runtime QA

## Verdict: PASSED

## Commands

| Command | Result |
|---|---|
| `npm --workspace @bytetrue/pi-vendor run build:web` | success |
| `npm --workspace @bytetrue/pi-vendor test` | 244/244 |
| `npm --workspace @bytetrue/pi-vendor run typecheck` | clean |
| `npm pack --workspace @bytetrue/pi-vendor --dry-run` | includes `src/web/assets/app.js` and server/client sources |
| `npm test` | pi-vendor 244 + pi-web-search 88 |

## Scenario coverage

- Loopback capability URL, Bearer/Host/Origin/method/content-type/body limits, CSP/no-store.
- SecretRef mask/hydrate with exact path + baseRevision; provider credential hydration non-consuming.
- Save/cancel first-terminal-wins, response finish before settle/close, active socket cleanup.
- Incomplete PUT remains open and cancellable before save claim.
- Startup failure destroys sockets, waits for close, clears active slot, permits later start.
- Actual `runWebSession` Esc and registered `session_shutdown` reasons.
- Static assets known/unknown/traversal; remote CDN scan shows only loopback/test fixture URLs.

## Residual risks

- Real browser opener platform variance still needs manual QA in hardening.
- Catalog/enrich/discover routes exist because accepted Feature 3 registered them; not a Runtime regression.

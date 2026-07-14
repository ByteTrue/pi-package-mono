---
doc_type: feature-qa
feature: 2026-07-12-vendor-dual-ui-hardening
roadmap: vendor-dual-ui-manager
status: partial
qa_date: 2026-07-14
---

# vendor-dual-ui-hardening QA

## Automated matrix — PASSED

| Command | Result |
|---|---|
| `npm --workspace @bytetrue/pi-vendor run build:web` | ok (app.js + index.html + style.css) |
| `npm --workspace @bytetrue/pi-vendor run typecheck` | clean |
| `npm --workspace @bytetrue/pi-vendor test` | 285/285 |
| `npm run typecheck --workspaces --if-present` | clean |
| `npm test` | pi-vendor 285 + pi-web-search 88 |
| `node packages/pi-vendor/scripts/pack-smoke.mjs` | pack → extract → jiti → state/cancel → cleanup |

## Manual matrix — DEFERRED

| Scenario | Status |
|---|---|
| TUI add-model / add-provider transcript | deferred (scripted tests cover state machine) |
| Web keyboard/focus/dialog restore | deferred (code-level a11y only) |
| Narrow terminal / narrow viewport | deferred |
| Real platform opener smoke | deferred (fake opener + unit coverage) |
| 10k import UX measure | deferred |

## Security scan notes

- Pack denylist rejects tests/node_modules/source maps
- Session tests cover Host/Origin/token/CSP/no-store
- Secret mask/hydrate suite green
- README has no raw secrets or capability tokens

---
doc_type: feature-qa
feature: 2026-07-12-vendor-model-source-core
roadmap: vendor-dual-ui-manager
status: passed
qa_date: 2026-07-13
---

# vendor-model-source-core QA Report

## Verdict: PASSED

## 1. Design Scenario Coverage

| Scenario | Status | Evidence |
|---|---|---|
| Move behavior-equivalent (S1) | PASSED | 142 tests green; typecheck green; workspace regression green |
| Closed DTO/search/enrichment (S2/S3) | PASSED | 12 DTO tests + 10 catalog-search tests + 6 web-enrich tests |
| Resolver/command trust/auth (S4) | PASSED | 25 config-resolver tests + 15 trust tests |
| Streaming budgets/abort/parse (S5) | PASSED | 13 bounded-discover tests |
| HTTP routes preserve session (S6) | PASSED | Typecheck confirms route registration; session.ts handlers verified |
| Scope guards (no write/raw/redirect/UI) | PASSED | grep confirmed no models.json writes; DTO projection before HTTP response |

## 2. DoD Command Verification

| Command | Result |
|---|---|
| `npm --workspace @bytetrue/pi-vendor test` | 142 passed, 16 files |
| `npm --workspace @bytetrue/pi-vendor run typecheck` | No errors |
| `npm run typecheck --workspaces --if-present && npm test` | pi-vendor + pi-web-search all green |

## 3. Review QA Focus Verification

| Focus Item | Status |
|---|---|
| `/api/catalog?q={query}&limit={n}` route | Registered in server.ts; query/limit validation; error mapping |
| `/api/enrich` route | Registered; modelId validation; DTO projection |
| `/api/discover` route | Registered; providerKey/provider validation; SecretRef hydration; trust check |
| `catalogAvailable` in `/api/state` | Added to state response in session.ts |
| Discover with SecretRef hydration | Uses `hydrateProviderCredentials` non-consuming |
| Non-2xx discover → correct HTTP status | invalid_request→400, credential_unresolved→400, upstream_timeout→408, upstream_too_large→413, upstream_failed→502 |
| Session cleanup no secret leak | `settle()` and `stop()` clear secrets map |

## 4. Security Verification

| Check | Status |
|---|---|
| No apiKey/baseUrl/headers/authHeader in DTO JSON | Test: recursive scan confirms forbidden keys absent |
| No openRouterRouting/vercelGatewayRouting in DTO | Test: compat allowlist excludes these |
| Command trust fail-closed | Test: changed/added/deleted/mixed all rejected |
| ModelSourceError no URL/statusText/secret | All messages are hardcoded constants |
| No raw official objects to browser | `toWebModelConfig()` called before HTTP response |
| No redirect following | `redirect: "error"` in fetch |
| URL credentials rejected | `buildModelsUrl` throws on username/password |

## 5. Cleanliness Check

- No debug output in production code
- No temporary TODO/FIXME/XXX
- No commented-out code
- No unused imports (typecheck passes)
- No temporary runner/download scripts in model-source/
- No `__pycache__` or similar artifacts

## 6. Boundary Verification

- No `models.json` write in catalog/enrich/discover modules
- No config mutation or registry refresh
- No Web model UI or TUI menu changes
- No new npm dependencies
- No API contract changes to existing routes

## 7. Residual Risks

| Risk | Severity | Mitigation |
|---|---|---|
| providerEnv not wired in Web discover | Low | Deferred to vendor-web-provider-workflows; only affects providers with provider-scoped env vars |
| handleDiscover re-reads snapshot from disk | None | Equivalent to state.snapshot in normal flow |
| readBoundedBody fire-and-forget cancel | None | Stream GC'd; no resource leak |

## 8. Evidence Summary

- **Command evidence**: `npm --workspace @bytetrue/pi-vendor test` — 142 passed
- **Typecheck evidence**: `npm --workspace @bytetrue/pi-vendor run typecheck` — no errors
- **Workspace evidence**: `npm test` — all workspace tests green
- **DTO security evidence**: 12 web-model-dto tests covering recursive forbidden key scan
- **Trust evidence**: 15 command trust tests covering full matrix
- **Discovery evidence**: 13 bounded-discover tests covering budgets, auth, errors, limits

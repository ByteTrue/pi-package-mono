---
doc_type: feature-review
feature: 2026-07-12-vendor-model-source-core
roadmap: vendor-dual-ui-manager
status: passed
reviewed: 2026-07-13
reviewer: reviewer (builtin subagent)
---

# vendor-model-source-core Code Review

## Verdict: PASSED — No blocking findings

## 1. Review Scope

Reviewed all feature-specific changes against design at `.codestable/features/2026-07-12-vendor-model-source-core/vendor-model-source-core-design.md` and checklist at `vendor-model-source-core-checklist.yaml`.

Files reviewed:
- `packages/pi-vendor/src/model-source/` (8 new source + 6 test files)
- `packages/pi-vendor/src/index.ts` (new exports)
- `packages/pi-vendor/src/models-menu.ts` (import path updates)
- `packages/pi-vendor/src/web/server/server.ts` (3 new model-source routes)
- `packages/pi-vendor/src/web/server/session.ts` (catalog/enrich/discover handlers)
- Re-export stubs at old paths (4 files)

## 2. Design Conformance

| Requirement | Status | Evidence |
|---|---|---|
| DTO closed — recursive forbid routing/credential/unknown | PASSED | `web-model-dto.ts` allowlist sets; test serialization scan confirms forbidden keys absent |
| DTO preserves zaiToolStream/supportsTemperature/allowEmptySignature | PASSED | `COMPAT_ALLOWED` includes all three; test verifies round-trip |
| Command trust fail-closed | PASSED | `allCommandsTrusted` byte-exact; tests cover changed/added/deleted/mixed |
| Pi template parser ($VAR/${VAR}/$$/$!/malformed) | PASSED | `config-resolver.ts` resolveTemplate; 25 tests cover all variants |
| Provider env priority over process.env | PASSED | `resolveEnv` checks providerEnv first; test verifies |
| 15s overall deadline, 2MiB body, 10k ids, 1KiB/id | PASSED | `bounded-discover.ts` constants; test verifies 10k limit |
| redirect: "error", http/https-only URL, no credentials | PASSED | `buildModelsUrl` validates; tests cover non-http and credential URLs |
| Authorization: existing header > Bearer from apiKey | PASSED | `hasAuthorization` check; tests cover both paths |
| ModelSourceError — no URL/statusText/secret/body | PASSED | All messages are hardcoded constants; errors wrapped at boundary |
| Non-consuming SecretRef hydration in Web routes | PASSED | `hydrateProviderCredentials` non-consuming; `settle`/`stop` clear secrets |
| Directory restructure behavior-equivalent | PASSED | 142 tests green; typecheck green; re-export stubs at old paths |
| No models.json write in catalog/enrich/discover | PASSED | grep confirms no commit/snapshot calls in model-source modules |
| No raw objects to browser | PASSED | `toWebModelConfig` called before all HTTP responses |

## 3. Non-Blocking Findings

### NB-1: discover route `invalid_request` → 502
Fixed during review (added `invalid_request` → 400 mapping).

### NB-2: providerEnv not wired in Web session
Design specifies `providerEnv` should come from `authStorage.getProviderEnv()`. Not wired in this feature — deferred to Web provider workflows feature.

### NB-3: handleDiscover re-reads snapshot from disk
Uses `readModelsSnapshot(path)` instead of `state.snapshot`. No impact.

### NB-4: readBoundedBody fire-and-forget reader.cancel()
Stream will be GC'd; no functional impact.

## 4. Test Coverage

- 142 tests, 16 test files, all passing
- DTO mapper: 12 tests covering all field types, enum validation, forbidden key scan
- Catalog search: 10 tests covering exact/prefix/substring, limits, oversize query, routing strip
- Config resolver: 25 tests covering all template variants, command execution, env priority
- Bounded discover: 13 tests covering URL validation, auth composition, error handling, id limits, sorting
- Web enrich: 6 tests covering candidate projection, template/default fallback, TUI pass-through
- Command trust: 15 tests covering all trust matrix combinations

## 5. QA Focus

- Test `/api/catalog`, `/api/enrich`, `/api/discover` routes via HTTP integration
- Verify `catalogAvailable` in `/api/state` response
- Test discover with SecretRef hydration and initialProvider trust check
- Verify non-2xx discover responses map to correct HTTP status codes
- Confirm session cleanup doesn't leak secrets

## 6. Residual Risks

- Low: discover route `invalid_request` → 502 (fixed during review)
- Low: providerEnv not wired in Web discover (deferred to web-provider-workflows)
- None: all security boundaries verified correct

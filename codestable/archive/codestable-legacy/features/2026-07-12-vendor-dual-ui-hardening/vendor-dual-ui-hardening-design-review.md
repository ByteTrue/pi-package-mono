---
doc_type: feature-design-review
feature: 2026-07-12-vendor-dual-ui-hardening
status: passed
reviewed: 2026-07-12
round: 1
---

# vendor-dual-ui-hardening design review

## Inputs

Hardening design/checklist, roadmap/items, six passed child designs/reviews, package/CI/package/README facts.

### Independent Review

- Completed strict read-only Paseo `d1247496-00cf-4208-ac6f-d8f972a8f8ef` (`deepseek-v4-pro`)，blocking 0 / important 0
- Independent gate satisfied；reviewer did not write files

## Summary

Evidence-first cross-surface closeout；reproducible Web assets；actual tarball extract/runtime smoke；CI/peer；errors/races/secrets/a11y/platform/perf/docs；no new feature/release/broad cleanup。

## Findings

### blocking
- [x] reviewer pending

### important
none

### nit
- Jiti resolution made explicit through installed coding-agent package paths；no root-hoist/dev-dependency assumption。

### suggestion
- Node22/npm ci reproducibility and peer-fixture ownership already explicit；no extra scope。

### praise
- Hardening only fixes observed acceptance failures and proves packed artifact, rather than becoming a feature/refactor bucket.

## User Review Focus

Actual tarball smoke, generated asset guard, manual browser/TUI evidence, documented strict-JSON/comment limitation, no release/commit/push.

## Evidence Ledger

| Check | Verdict | Evidence |
|---|---|---|
| Acceptance/checklist trace | pass | 15 scenarios/12 checks |
| Roadmap compliance | pass | reviewer confirmed hardening item |
| Pack/CI feasibility | pass | extracted layout/generated/peer seams confirmed |
| Validation/a11y/docs | pass | commands/manual/reports |

## Residual Risk

Browser close needs Pi Esc；revision is not lock；unknown custom secrets unmasked；10k virtualization measure-first。

## Verdict

- Status: passed
- Next: all 7 child designs passed；enter unified owner design checkpoint.

# Commit plan — vendor-dual-ui-manager

## Suggested single commit (local only)

**Subject:**

```
feat(pi-vendor): dual TUI+Web model manager with pack smoke
```

**Body:**

```
Deliver shared config core, model-source, TUI quick workflows, and
one-shot Web modal manager (provider + model) behind /vendor and
/vendor web. Add real tarball pack-smoke, CI generated-asset guard,
and dual-UI README.

Includes .codestable design/review/QA evidence for the epic.
Does not bump version or publish.
```

## Paths to include

### Product
- `packages/pi-vendor/**` (sources, tests, assets, scripts, README, package.json)
- `.github/workflows/ci.yml`
- `package-lock.json` (if peer/lock churn is intentional)

### Evidence / process
- `.codestable/brainstorms/vendor-dual-ui-manager/`
- `.codestable/features/2026-07-12-vendor-*/`
- `.codestable/roadmap/vendor-dual-ui-manager/`

## Pre-commit checks (already green)

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm test
node packages/pi-vendor/scripts/pack-smoke.mjs
git status --porcelain -- packages/pi-vendor/src/web/assets   # empty after add
```

## Not in this commit

- version bump / npm publish / push
- unrelated packages beyond lockfile if dirty for other reasons

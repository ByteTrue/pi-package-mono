# AGENTS.md

Guidance for AI coding agents (and new humans) working in this repository. The
goal: you can build, test, and submit changes correctly without asking anyone.

## What this repo is

An **npm workspaces** monorepo (not pnpm, not yarn) of independent extension
packages for the [Pi coding agent](https://pi.dev). Packages are intentionally
independent: no package depends on another, and each installs, versions, and
releases on its own. Most packages ship as TypeScript source loaded via jiti at
runtime; only `pi-image-gen` has a build step (its bundled Skill CLI and
extension share compiled code).

## Repository map

| Path | What it is |
| --- | --- |
| `packages/pi-background-terminal` | `background_run` / `background_status` / `background_kill` tools + `/background` menu. Pure-background execution: built-in `bash`/`powershell` stay untouched (no foreground-timeout hook — that lives in `pi-bash-timeout`) |
| `packages/pi-bash-timeout` | Optional 300s default-and-cap for the built-in `bash`/`powershell` tools (two event hooks; registers no tools). Install it only when the cap is wanted |
| `packages/pi-image-gen` | `/image-gen` TUI setup, on-demand Skill + bundled CLI. The only package with `build`/`prepack` |
| `packages/pi-subagent` | `subagent` / `subagent_status` / `subagent_stop` tools + `/subagent` menu. Tool schemas stay tiny (~200 tokens total) |
| `packages/pi-vendor` | AI-first `models.json` management: Skill for everyday CRUD, on-demand `vendor.mjs` script, `/vendor` cold-start wizard |
| `packages/pi-vision` | `image_ask` tool + opt-in attachment pre-analysis + `/vision`. Auto mode stays opt-in by design |
| `packages/pi-web-search` | `web_search` / `web_fetch` tools + `/web` setup. `npm test` auto-skips its live e2e file |
| `byissue/` | Project memory: current spec (`byissue/spec/index.md`), decisions, past epics/issues, pitfall notes. Mostly Chinese |
| `byspace.json` | Worktree setup (`npm ci`) and typecheck/test scripts for agent worktrees |
| `tsconfig.base.json` | Shared strict TS config: ES2022, NodeNext, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` |

Every package has its own `README.md` (user-facing setup and behavior) and a
sub-spec under `byissue/spec/<pkg>/` (architecture and constraints).

## Commands

All commands run from the repository root. CI uses Node 22.

```bash
npm ci                                        # install; required before anything else
npm run typecheck --workspaces --if-present   # typecheck every package (tsc --noEmit)
npm test                                      # test every package (vitest); full run < 30s
npm --workspace @bytetrue/<pkg> test          # one package's tests
npm --workspace @bytetrue/<pkg> run typecheck # one package's typecheck
npm --workspace @bytetrue/pi-image-gen run build  # the only build step in the repo
```

- **No lint setup** — there is no ESLint/Prettier config and CI does not lint.
  Do not add lint dependencies or config as a drive-by.
- `pi-web-search` live e2e: `npm --workspace @bytetrue/pi-web-search run test:e2e`
  needs real provider credentials (`live.e2e.local.json` or `BYTE_PI_WEB_E2E_CONFIG`,
  plus `BYTE_PI_WEB_LIVE_E2E=1`). It is skipped in normal `npm test` and never runs
  in CI. Do not run it unless asked.

## When you change something, run

| You touched | Must pass before you open the PR |
| --- | --- |
| one package's code | that package's `typecheck` + `test` |
| several packages, root config, or `tsconfig.base.json` | full `npm run typecheck --workspaces --if-present` + `npm test` |
| `pi-image-gen` core, bundled CLI, or Skill | `npm --workspace @bytetrue/pi-image-gen run build` + `node packages/pi-image-gen/scripts/pack-smoke.mjs` |
| any `package.json` `files`/`exports`/`bin` | `npm --workspace @bytetrue/<pkg> pack --dry-run` |
| `byissue/` docs only | nothing; a `docs(byissue)` commit is fine |

CI (`.github/workflows/ci.yml`, runs on every PR) is exactly: `npm ci` →
workspaces typecheck → `npm test` → `pi-vendor` pack dry-run → `pi-image-gen`
pack smoke. Match it locally and CI will be green.

Tests live next to the code they cover as `src/*.test.ts` (vitest). Fix a bug
by adding a failing test first, then the fix.

## Conventions

- **Commits**: Conventional Commits, package-scoped — `feat(pi-web-search): ...`,
  `fix(pi-subagent): ...`, `docs(byissue): ...`. Releases use
  `release(<pkg>): <version> - <summary>`.
- **PRs**: title format `BYTE-N: <summary>` — the `BYTE-N` issue key is how a PR
  links back to its tracking issue in our workspace.
- **TypeScript**: strict, `noUncheckedIndexedAccess` (index access returns
  `T | undefined`), `verbatimModuleSyntax` (use `import type`). Do not relax the
  config to make code compile; fix the code.
- **Style**: no formatter is configured and files deliberately differ (tabs in
  `pi-vendor`/`pi-web-search`, spaces in the other packages). Match the file you edit.
- **Architecture**: packages stay independent — never add a cross-package
  dependency. Pi tool names must be unique; do not register names taken by Pi
  built-ins or other extensions (e.g. `web_search`).
- **Docs are part of the change**: a user-visible behavior change also updates the
  package README and its `byissue/spec/<pkg>/index.md` sub-spec.
- **Releases (only when explicitly asked)**: bump the package version, push tag
  `pi-<pkg>-v<version>` (e.g. `pi-web-search-v0.5.2`); `release.yml` publishes via
  npm OIDC Trusted Publishing. Never push release tags on your own.

## Reading `byissue/` before non-obvious work

`byissue/` is the repo's institutional memory. Before redesigning anything:

1. `byissue/spec/index.md` — current architecture, direction, config surfaces.
2. `byissue/spec/<pkg>/index.md` — the package's constraints and invariants.
3. `byissue/decisions/` — why settled questions were settled.
4. `byissue/notes/` — practical pitfalls (npm workspaces trade-offs, local
   package loading, shared worktrees).
5. `byissue/epics/`, `byissue/issues/` — historical record, not current truth.

Known doc drift (2026-10-09): `byissue/spec/index.md` still says "seven packages"
and describes `pi-browser`, which was removed from the repo on 2026-09-24.
`packages/` is authoritative — **six** packages exist today.

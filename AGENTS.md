# AGENTS.md

Guidance for AI coding agents (and new humans) working in this repository. The
goal: you can build, test, and submit changes correctly without asking anyone.

## What this repo is

An **npm workspaces** monorepo (not pnpm, not yarn) of independent extension
packages for the [Pi coding agent](https://pi.dev). Packages are intentionally
independent: no package depends on another, and each installs, versions, and
releases on its own. Packages ship as TypeScript source loaded via jiti at
runtime; there is no package build step.

Image generation, vision, and web access have moved to
[Satchel](https://github.com/ByteTrue/satchel). `pi-vendor` instead lives here as
a small extension because it owns Pi's `models.json` and `/vendor` TUI. Their old
npm releases remain available, but the retired package sources must not return
without a new explicit decision.

## Repository map

| Path | What it is |
| --- | --- |
| `packages/pi-background-terminal` | `background_run` / `background_status` / `background_kill` tools + `/background` menu. Pure-background execution: built-in `bash`/`powershell` stay untouched |
| `packages/pi-subagent` | `subagent` / `subagent_status` / `subagent_stop` tools + `/subagent` menu. Tool schemas stay tiny (~200 tokens total) |
| `small-extensions/` | Tiny single-file extensions, **not published to npm**: one subdirectory each (single `.ts` + tests + private `package.json`), installed by `scripts/install-small-extension.mjs` (Node arrow-key picker, or `--all`) from GitHub raw. In root `workspaces` only so CI typecheck/tests cover them |
| `byissue/` | Project memory: current spec (`byissue/spec/index.md`), decisions, past epics/issues, pitfall notes. Mostly Chinese |
| `.agents/skills/` | Project-level skills (tracked). `pi-dev-setup` regenerates this worktree's project-level Pi debug config (`.pi/settings.json` + `.pi/extensions/`); the `.pi/` outputs themselves are gitignored |
| `byspace.json` | Worktree setup (`npm ci`) and typecheck/test scripts for agent worktrees |
| `tsconfig.base.json` | Shared strict TS config: ES2022, NodeNext, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` |

Every package has its own `README.md` (user-facing setup and behavior) and a
sub-spec under `byissue/spec/<pkg>/` (architecture and constraints).
`packages/` is authoritative: **two** packages exist today.

## Commands

All commands run from the repository root. CI uses Node 22.

```bash
npm ci                                        # install; required before anything else
npm run typecheck --workspaces --if-present   # typecheck every package (tsc --noEmit)
npm test                                      # test every workspace (vitest)
npm --workspace @bytetrue/pi-background-terminal test
npm --workspace @bytetrue/pi-subagent run typecheck
```

- **No lint setup** — there is no ESLint/Prettier config and CI does not lint.
  Do not add lint dependencies or config as a drive-by.
- `node scripts/check-readme-packages.mjs` and
  `node scripts/check-small-extension-installer.mjs` keep the two install lists
  synchronized with the directories.

## When you change something, run

| You touched | Must pass before you open the PR |
| --- | --- |
| one package's code | that package's `typecheck` + `test` |
| several packages, root config, or `tsconfig.base.json` | full `npm run typecheck --workspaces --if-present` + `npm test` |
| any `package.json` `files`/`exports`/`bin` | `npm --workspace @bytetrue/<pkg> pack --dry-run` |
| `byissue/` docs only | nothing; a `docs(byissue)` commit is fine |

CI (`.github/workflows/ci.yml`, runs on every PR) is exactly: README/installer
consistency gates → `npm ci` → workspaces typecheck → `npm test`. Match it
locally and CI will be green.

Tests live next to the code they cover as `src/*.test.ts` (vitest). Fix a bug
by adding a failing test first, then the fix.

## Conventions

- **Commits**: Conventional Commits, package-scoped — `feat(pi-subagent): ...`,
  `fix(pi-background-terminal): ...`, `docs(byissue): ...`. Releases use
  `release(<pkg>): <version> - <summary>`.
- **PRs**: no title format is enforced. A title that names the package and the
  change is enough (`feat(pi-subagent): ...` style is fine).
- **TypeScript**: strict, `noUncheckedIndexedAccess` (index access returns
  `T | undefined`), `verbatimModuleSyntax` (use `import type`). Do not relax the
  config to make code compile; fix the code.
- **Style**: no formatter is configured and files deliberately differ. Match the
  file you edit.
- **Architecture**: packages stay independent — never add a cross-package
  dependency. Pi tool names must be unique; do not register names taken by Pi
  built-ins or other extensions.
- **Small extensions** (`small-extensions/`): not published to npm; copied
  directly into `~/.pi/agent/extensions/` (plus any companion files listed in
  `scripts/install-small-extension.mjs`) and loaded by Pi without `npm install`.
  Because `~/.pi/agent/extensions/` has no `node_modules`, they must not import
  third-party npm packages or uncopied repo files (`node:*` built-ins and
  type-only imports are fine; Pi host modules must be resolved from the running
  Pi installation). Its `package.json` is `private: true` and exists only for
  workspace CI; never add `publishConfig`/`pi` fields there.
- **Docs are part of the change**: a user-visible behavior change also updates the
  package README and its `byissue/spec/<pkg>/index.md` sub-spec.
- **Releases (only when explicitly asked)**: bump the package version, push tag
  `pi-background-terminal-v<version>` or `pi-subagent-v<version>`;
  `release.yml` publishes via npm OIDC Trusted Publishing. Never push release
  tags on your own.

## Reading `byissue/` before non-obvious work

`byissue/` is the repo's institutional memory. Before redesigning anything:

1. `byissue/spec/index.md` — current architecture, direction, config surfaces.
2. `byissue/spec/<pkg>/index.md` — the package's constraints and invariants.
3. `byissue/decisions/` — why settled questions were settled.
4. `byissue/notes/` — practical pitfalls (npm workspaces trade-offs, local
   package loading, shared worktrees).
5. `byissue/epics/`, `byissue/issues/` — historical record, not current truth.

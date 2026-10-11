# Contributing: review & CI workflow

How changes land in this repository. [AGENTS.md](AGENTS.md) covers build/test
commands and code conventions; this file covers the review and CI process.

## Review process

- **PRs remain the default path.** A PR gives CI + review + traceability, and
  it stays the right shape for anything risky or half-finished. But direct
  pushes to `main` are allowed — see "Direct pushes" below.
- **Humans review; agents wait.** Agents never approve or merge their own PRs.
- **Agent-produced changes go through a PR and wait for review:**
  1. Open the PR. No title format and no tracking-issue link are required — a
     summary that names the change is enough.
  2. Stop there. Merging is the member's decision; an agent may run the merge
     only after the member explicitly authorizes it.
- **Self-check before requesting review.** An agent does not hand a red CI to
  review: mirror CI locally first (`npm ci` → workspaces typecheck → `npm test`,
  plus build + pack-smoke when `pi-image-gen` changed, plus
  `node scripts/check-readme-packages.mjs` when the root README or the package
  set changed), write a PR description
  that states what, why, and how it was verified, then push again if CI fails.
- **Keep each PR small and single-purpose.** Unrelated fixes get their own PR.

## What CI checks

`.github/workflows/ci.yml` runs on every PR and every push to `main`:

| Check | What it does |
| --- | --- |
| workspaces typecheck | `tsc --noEmit` in every package |
| `npm test` | vitest in every package (live e2e excluded by design) |
| `pi-vendor` pack dry-run | the publishable file list stays sane |
| `pi-image-gen` pack smoke | real tarball: pack → allowlist → extract → production install → load extension entry |
| README ↔ packages check | root README's package table and install list match `packages/*` — no missing package, no stale reference |

Superseded runs on the same branch are cancelled automatically (concurrency
group). `.github/workflows/release.yml` publishes on version tags: typecheck +
test first, then npm publish via OIDC Trusted Publishing.

## Low-risk changes

Docs-only edits, comments, and formatting can go through a PR like anything
else, but mark them `low-risk` in the PR body — review can be
a quick skim. The CI gate is identical; "low-risk" never skips CI.

## Parallel agent work

Several agent tasks may run in parallel on this repository, but only when
**all three** conditions hold — otherwise the tasks run serially:

1. **Disjoint file domains.** The tasks touch disjoint sets of files, and each
   task description states its file domain (the exact paths it may change).
   A task that cannot name its file domain is not parallel-safe.
2. **No output dependencies.** No task consumes another task's output; each
   task can finish on its own.
3. **No root files or repository-level state.** Parallel tasks never touch
   root files (`package.json`, `package-lock.json`, `tsconfig.base.json`,
   `.github/`, top-level docs) or repo-level state (branches, tags, releases)
   unless the task explicitly owns them.

Additional rules for parallel runs:

- **Declare the file domain up front.** A subtask that turns out to need paths
  outside its declared domain stops and reports instead of expanding scope.
- **Superseded CI runs are cancelled automatically.** CI runs with
  `cancel-in-progress`, so a new push to the same PR/branch cancels the
  previous run — only the latest run counts.
- For the git-level pitfalls of two sessions actually sharing a single
  checkout — not recommended — see
  `byissue/notes/013-parallel-agent-sessions-sharing-one-worktree.md`.

## Direct pushes

Direct pushes to `main` are allowed. There is no branch protection and no
emergency-lane ceremony.

- **Who may push directly:** the member, and an agent when the member
  explicitly authorizes that specific push in the conversation.
- **CI still runs on every push to `main`** — a red run after a direct push
  means fix forward immediately.
- **Keep the history explainable:** Conventional Commits with a package scope
  remain the expectation on `main`, PR or not.
- Decision `byissue/decisions/006-direct-push-policy.md` supersedes the former
  emergency-lane rules recorded in
  `byissue/decisions/005-direct-push-retroactive-record.md`.

The former three-step emergency checklist (authorize → register → follow-up
PR record) is retired by decision 006; decision 005 stays as history.

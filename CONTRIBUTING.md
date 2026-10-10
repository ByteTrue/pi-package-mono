# Contributing: review & CI workflow

How changes land in this repository. [AGENTS.md](AGENTS.md) covers build/test
commands and code conventions; this file covers the review and CI process.

## Review process

- **Every change lands via PR.** No direct pushes to `main` — including docs.
- **Humans review; agents wait.** The member reviews and merges. Agents never
  approve or merge their own work.
- **Agent-produced changes always go through a PR and wait for review:**
  1. Open the PR with title `BYTE-N: <summary>` — the issue key auto-links it
     to the tracking issue in our workspace.
  2. Set the issue to `in_review` and stop there. Merging is the member's
     decision; an agent may run the merge only after the member explicitly
     authorizes it on the issue (the authorization stays as a comment).
- **Self-check before requesting review.** An agent does not hand a red CI to
  review: mirror CI locally first (`npm ci` → workspaces typecheck → `npm test`,
  plus build + pack-smoke when `pi-image-gen` changed, plus
  `node scripts/check-readme-packages.mjs` when the root README or the package
  set changed), write a PR description
  that states what, why, and how it was verified, then push again if CI fails.
- **One PR per issue, kept small and single-purpose.** Unrelated fixes get
  their own issue and PR.

## What CI checks

`.github/workflows/ci.yml` runs on every PR and every push to `main`:

| Check | What it does |
| --- | --- |
| workspaces typecheck | `tsc --noEmit` in every package |
| `npm test` | vitest in every package (live e2e excluded by design) |
| `pi-vendor` pack dry-run | the publishable file list stays sane |
| `pi-image-gen` pack smoke | real tarball: pack → allowlist → extract → production install → load extension entry |
| README ↔ packages check | root README's package table and install list match `packages/*` — no missing package, no stale reference |
| PR title | must match `BYTE-N: ...` or `Release ...` (enforced via a CI job) |

Superseded runs on the same branch are cancelled automatically (concurrency
group). `.github/workflows/release.yml` publishes on version tags: typecheck +
test first, then npm publish via OIDC Trusted Publishing.

## Low-risk changes

Docs-only edits, comments, and formatting still go through a PR (everything on
`main` stays traceable), but mark them `low-risk` in the PR body — review can be
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
- One issue, one PR (see the review process above). For the git-level pitfalls
  of two sessions actually sharing a single checkout — not recommended — see
  `byissue/notes/013-parallel-agent-sessions-sharing-one-worktree.md`.

## Emergencies

- The member may push or merge directly to `main` when a release or security
  issue blocks on process — the member holds final authority over `main`.
- Agents have no emergency lane. If something is urgent, set the issue to
  `blocked` and ping the member; do not bypass review.

Direct-push checklist — all three steps, every use (worked record:
`byissue/decisions/005-direct-push-retroactive-record.md`):

1. **When it may be used** — the member explicitly authorizes it, and a PR
   cannot land in time (release or security blocked on process).
2. **Register it** — leave the standard record as a `byissue/decisions/`
   entry: authorizer + time + scope + the full list of pushed SHAs.
3. **Afterwards** — open the PR or issue record within 24 hours so the
   history stays explainable.

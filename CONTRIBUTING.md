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
  plus build + pack-smoke when `pi-image-gen` changed), write a PR description
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
| PR title | must match `BYTE-N: ...` or `Release ...` (enforced via a CI job) |

Superseded runs on the same branch are cancelled automatically (concurrency
group). `.github/workflows/release.yml` publishes on version tags: typecheck +
test first, then npm publish via OIDC Trusted Publishing.

## Low-risk changes

Docs-only edits, comments, and formatting still go through a PR (everything on
`main` stays traceable), but mark them `low-risk` in the PR body — review can be
a quick skim. The CI gate is identical; "low-risk" never skips CI.

## Emergencies

- The member may push or merge directly to `main` when a release or security
  issue blocks on process — the member holds final authority over `main`.
  Follow up with a PR or an issue record within 24 hours so the history stays
  explainable.
- Agents have no emergency lane. If something is urgent, set the issue to
  `blocked` and ping the member; do not bypass review.

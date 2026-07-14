# @bytetrue/pi-vendor

Manage custom providers and models for the [pi coding agent](https://pi.dev) in `models.json`.

Path: `$PI_CODING_AGENT_DIR/models.json` or `~/.pi/agent/models.json`.

[![npm version](https://img.shields.io/npm/v/@bytetrue/pi-vendor?style=flat-square)](https://www.npmjs.com/package/@bytetrue/pi-vendor)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](../../LICENSE)

## Features

- **Quick TUI workflows** — `/vendor` for high-frequency add-model / add-provider paths
- **Full Web manager** — `/vendor web` opens a one-shot local browser modal for complete provider + model management
- **Shared config core** — mutations and Pi `ModelRegistry` compatibility oracle used by both surfaces
- **Opaque keep-value secrets** — known secret paths leave the browser as refs; raw values stay server-side
- **Bounded discovery** — optional OpenAI-compatible `/models` import with deadlines, body limits, and command-trust preflight

## Install

```bash
pi install npm:@bytetrue/pi-vendor
```

Or from a local monorepo checkout:

```bash
pi install /absolute/path/to/pi-package-mono/packages/pi-vendor
```

Peer: `@earendil-works/pi-coding-agent` `>=0.79.10`.

## Quick TUI workflows

Run `/vendor` in an interactive Pi TUI session:

1. **Add model** — pick an existing provider, choose catalog / custom / import, confirm conflicts, then **Save** (one commit) or **Add another** / **Cancel** (zero commit)
2. **Add provider** — shortest wizard: key → baseUrl → api format → apiKey → first model → summary → Save
3. **Open full manager** — launches the Web modal
4. **Cancel** — Esc returns to the parent step; root Cancel writes nothing

Non-interactive environments fail fast (no silent file writes).

## Full Web manager

Run `/vendor web` (or choose **Open full manager** from the root menu).

Lifecycle (one-shot modal, no daemon):

1. Pi starts a loopback server on `127.0.0.1` with a random port and bearer token
2. Browser opens a capability URL; edits stay in memory as a draft
3. **Save** validates, checks revision, hydrates opaque secrets, atomic write, then closes the server
4. **Cancel** / Esc in Pi discards the draft and closes the server

If the browser tab is closed without Cancel, return to Pi and press **Esc** so the session can settle.

## How Save / Cancel works

| Action | Disk write | Session |
|---|---|---|
| TUI **Save** | Exactly one conditional commit + registry refresh | ends |
| TUI **Cancel** / Esc / Add another (without Save) | Zero | continues or ends without write |
| Web **Save** | One `PUT /api/config` with revision; `409` on conflict | settles after response finishes |
| Web **Cancel** | Zero | settles cancelled |

Revision format is optimistic (`sha256:…`), not a cross-process lock.

## Credentials and opaque keep-value

- Existing secrets are sent to the browser as opaque refs (`pi-vendor-secret:…`), not raw values
- Save hydrates only exact path + matching base revision; moved/copied/fabricated refs fail closed
- New literal secrets you type in the browser are written on Save (they must leave the browser once)
- Env references and command values are classified in UI; command execution only happens server-side during trusted discovery
- Raw JSON never reveals stored secret material

## `/models` discovery and command trust

- Discover uses `http`/`https` only, `redirect: error`, overall deadline, and a decoded body budget
- Command-bearing `apiKey` / header values are preflighted against the initial provider snapshot; any untrusted command → zero runner/fetch calls
- Errors use typed codes only (no URL body / statusText / command stdout leakage)

## Conflicts and recovery

| Situation | Recovery |
|---|---|
| Provider/model id already exists | Explicit overwrite confirm (no silent upsert) |
| Web `config_changed` (409) | Close and reopen the manager |
| `invalid_secret_ref` after rename/reorder | Re-enter or remove the secret (no implicit remap) |
| Invalid config / validator unavailable | Draft kept; fix issues and retry |
| Concurrent Web session | Only one active session; cancel or finish the existing one |

## Security boundaries / limitations

- Loopback bind only; random port + bearer token; CSP + `Cache-Control: no-store`
- No remote JS/CDN/fonts in the Web UI
- Config core uses strict JSON (no BOM/comments); Pi may accept richer catalogs elsewhere
- Unknown custom secret-bearing fields may not be masked if they are not on known paths
- Browser tab close cannot reliably notify the server — use Esc in Pi
- Revision checks are optimistic; extreme concurrent writers can still race between check and rename

## Development + build / pack verification

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm run typecheck --workspaces --if-present
npm test
node packages/pi-vendor/scripts/pack-smoke.mjs
```

`build:web` emits `src/web/assets/{app.js,index.html,style.css}`.
`pack-smoke` packs a real tarball, extracts it, loads runtime via jiti from the packed layout, hits state/cancel on loopback, and cleans up. It never opens a browser or writes your user config.

## Environment

Set `PI_CODING_AGENT_DIR` to redirect the agent directory (tests / backups). Defaults to `~/.pi/agent`.

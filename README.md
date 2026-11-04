<p align="center">
  <img src="./docs/images/overview.webp" alt="Focused instruments connected around a terminal core" width="100%">
</p>

<h1 align="center">Pi Package Mono</h1>

> [!IMPORTANT]
> **This repository is archived and read-only.** It was split into two repositories:
> - [`ByteTrue/pi-extensions-collection`](https://github.com/ByteTrue/pi-extensions-collection) — the drop-in extensions that used to live in `small-extensions/`, plus `pi-background-terminal`, all copied into `~/.pi/agent/extensions/` by one installer. No npm.
> - [`ByteTrue/pi-subagent`](https://github.com/ByteTrue/pi-subagent) — the subagent extension, installed from git: `pi install git:github.com/ByteTrue/pi-subagent`.
>
> Nothing here is published to npm anymore; the `release.yml` workflow below is kept only as history.

<!-- Decision record (BYTE-14): the slogan/tagline above is final — "delegated subagents" is the origin/BYTE-2 wording, concluded in b6d28c7f's README conflict resolution. Keep it on future README conflicts; do not re-litigate. -->
<p align="center">
  Focused extensions for <a href="https://pi.dev">Pi</a>: background processes, an optional shell timeout cap, and delegated subagents.
</p>

<p align="center">
  <a href="https://github.com/ByteTrue/pi-package-mono/actions/workflows/ci.yml"><img src="https://github.com/ByteTrue/pi-package-mono/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
</p>

Each package is independent. Install one capability without inheriting a framework, a shared runtime, or the prompt cost of unrelated tools.

> [!TIP]
> You do not need the whole monorepo. Pick the package that solves the task in front of you.

### Where the retired packages went

The retired npm packages now have these homes:

| Former package | Current form in Satchel |
| --- | --- |
| `pi-image-gen`, `pi-vision`, `pi-web-search` | One unified stdio MCP exposing `analyze_image`, `generate_image`, `generate_video`, `generation_result`, `web_search`, and `web_fetch`, subject to the user's CLI module switches |
| `pi-vendor` | The [`pi-vendor` small extension](small-extensions/pi-vendor) **in this repository**, preserving the Pi-specific `/vendor` TUI and atomic `models.json` updates, plus a `/vendor-ai` prompt command with relative bundled scripts |

Use `satchel setup` and `satchel mcp-config` for the Satchel MCP. Install `pi-vendor` through this repository's small-extension installer below, then use `/vendor` inside Pi. Vision is an explicit `analyze_image` tool; the old automatic attachment hooks are not carried over.

Previously published npm versions remain available, but these four packages are no longer developed or released from this repository. See the [Satchel README](https://github.com/ByteTrue/satchel#readme) for MCP installation and configuration.

## Choose a package

| You want Pi to… | Package | What it adds | First step |
| --- | --- | --- | --- |
| Keep a server, watcher, or long task running | [`@bytetrue/pi-background-terminal`](packages/pi-background-terminal) | `background_run`, `background_status`, `background_kill`, `/background` | Install and ask Pi to run a command without hanging on it |
| Cap runaway foreground `bash`/`powershell` commands at 300s (optional) | [`pi-bash-timeout`](small-extensions/pi-bash-timeout) (small extension, not on npm) | 300s default + cap + timeout-error steering for the built-in shell tools | Run the [small-extension install script](#small-extensions) |
| Let a long task drive itself to completion (optional) | [`pi-goal`](small-extensions/pi-goal) (small extension, not on npm) | `/goal` objective + `goal_start`/`goal_done`, auto-continued at Pi's settle boundary | Run the [small-extension install script](#small-extensions) |
| Delegate subtasks to child agents | [`@bytetrue/pi-subagent`](packages/pi-subagent) | `subagent`, `subagent_status`, `subagent_stop`, `/subagent` | Ask Pi to run a focused task in an isolated session |

## Install

Install any package from npm:

```bash
pi install npm:@bytetrue/pi-background-terminal
pi install npm:@bytetrue/pi-subagent
```

Restart or reload Pi after installation. Each package README covers its own setup and behavior.

> [!IMPORTANT]
> Pi tool names must be unique. Remove or disable another extension that already registers the same tool before installing a package.

## Developing this repo's packages in Pi

Project-level Pi config is **generated, not tracked**: run `node .agents/skills/pi-dev-setup/setup.mjs` in a fresh worktree (after `npm ci`) and it writes `.pi/settings.json` — every `packages/*` workspace loaded from local source, with shadow entries that silence any globally installed `@bytetrue/*` package of the same name — and copies the `small-extensions/` single files into `.pi/extensions/`. Idempotent; re-run after adding a package. Restart or /reload Pi to apply.

## Small extensions

A few extensions are deliberately tiny and are **not published to npm** — they live in [`small-extensions/`](small-extensions) and install straight from this repo (GitHub raw → `~/.pi/agent/extensions/`; `pi-vendor` also installs its relative scripts into `~/.pi/agent/extensions/pi-vendor/scripts/`). Installation is one Node script (Node 18+) that shows an arrow-key checklist, so you install only the extensions you want. Re-running it is the update path; there is no versioning.

```bash
# macOS / Linux — download, then pick from the menu
curl -fsSL https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.mjs -o /tmp/install-small-extension.mjs
node /tmp/install-small-extension.mjs
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.mjs -OutFile "$env:TEMP\install-small-extension.mjs"
node "$env:TEMP\install-small-extension.mjs"
```

In the menu: `↑`/`↓` move, `space` toggles, `a` toggles all, `enter` installs. `pi-context-guard` is **opt-in**: it starts unticked (marked in the menu) because it overrides session-wide behavior. Add `--all` to the `node` line to skip the menu and install every extension, opt-in ones included (scripts, CI, no terminal).

| Extension | What it adds |
| --- | --- |
| [`pi-bash-timeout`](small-extensions/pi-bash-timeout) | Optional 300s default-and-cap for the built-in `bash`/`powershell` tools (two event hooks; registers no tools) |
| [`pi-ask-user`](small-extensions/pi-ask-user) | Minimal `ask_user` tool: one decision question per call with typed options, answered via Pi's built-in dialogs |
| [`pi-goal`](small-extensions/pi-goal) | Minimal `/goal`: one durable objective per session, auto-continued at the settle boundary until the model calls `goal_done` with evidence. The model can also draft the objective itself via `goal_start` |
| [`pi-context-guard`](small-extensions/pi-context-guard) | **Opt-in.** Compact above 400k on large-window models, name the session file in the system prompt, and deterministically prune stale tool outputs with `ctx_reduce` / `ctx_search` / `ctx_expand` |
| [`pi-vendor`](small-extensions/pi-vendor) | Pi-specific `/vendor` TUI plus the `/vendor-ai` prompt command and relative bundled scripts, with catalog/discovery and atomic `models.json` updates |

## How the packages fit Pi

The repository keeps high-frequency and low-frequency capabilities separate:

- **Agent tools** stay small and explicit: background execution and subagent delegation.
- **TUI commands close the setup loop**: `/background` and `/subagent`.
- **No package depends on another package here.** Install, upgrade, or remove each one independently.
- **No package replaces Pi's built-in tools.** Background terminal, for example, complements `bash` rather than overriding it.

## Local development

This is an npm workspace monorepo:

```bash
npm ci
npm test
npm run typecheck --workspaces --if-present
```

Run a single package in isolation:

```bash
npm --workspace @bytetrue/pi-subagent test
npm --workspace @bytetrue/pi-subagent run typecheck
```

Load a checkout directly while developing:

```bash
pi install "$PWD/packages/pi-subagent"
```

## Repository map

```text
packages/
  pi-background-terminal/  Pure background execution: hands-off tasks with exit notifications
  pi-subagent/             Delegated subagents for focused child sessions
byissue/spec/           Current architecture and project decisions
small-extensions/       Tiny single-file extensions, installed by script (not on npm)
```

For AI coding agents working in this repository, [AGENTS.md](AGENTS.md) covers the build/test commands, per-package notes, and commit/PR conventions.

For package-specific installation, configuration, examples, and limits, follow the links in [Choose a package](#choose-a-package).

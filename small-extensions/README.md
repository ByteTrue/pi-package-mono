# Small extensions

Tiny, standalone Pi extensions that live in this repo as source — **not published to npm**. Each subdirectory is one extension: a single TypeScript file (loaded by Pi via jiti, no build step), its tests, and a README. Anything that outgrows this form (npm distribution, a build step, bundled assets) belongs in [`packages/`](../packages/) instead.

Extensions here are intentionally not npm packages: no versioning ceremony for a few hundred lines, and the install channel is the scripts below. `npm install` still covers this directory (root `workspaces` includes `small-extensions/*`) only so CI typecheck and tests run over it — the `package.json` in each subdirectory is private and never published.

## Install

| Platform | Command |
| --- | --- |
| macOS / Linux | `curl -fsSL https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.sh | bash` |
| Windows (PowerShell) | `irm https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.ps1 | iex` |

The scripts take no arguments: they download the extension files from this repo (`main` branch, GitHub raw) and copy them into `~/.pi/agent/extensions/`, overwriting whatever was there. Re-running the script is the update path — there is no versioning and no pinning.

Restart or reload Pi afterwards; extensions in that directory load automatically.

## Developing one

An installed copy in `~/.pi/agent/extensions/` and a local copy in `.pi/extensions/`
are both loaded — Pi dedupes extensions by resolved absolute path, not by file name,
so the same extension installed twice registers twice (duplicate `tool_result`
steering, duplicate compaction requests). When working on an extension, load only
the file under test and skip discovery entirely:

```bash
pi --no-extensions -e small-extensions/pi-context-guard/pi-context-guard.ts
```

`--no-extensions` drops every discovered extension (project, global, and built-in)
while explicit `-e` paths still load. A built-in extension the tested one needs can
be re-added the same way — `pi-codemode-only`, for example, needs
`-e builtin:codemode`. Disabling the installed copy instead (`pi config`) is
global: it writes `extensions: ["-extensions/<file>.ts"]` to
`~/.pi/agent/settings.json` and applies to every project, not just this one.

## What is here

| Extension | What it does |
| --- | --- |
| [`pi-bash-timeout`](./pi-bash-timeout/) | Optional 300s default-and-cap for the built-in `bash`/`powershell` tools (two event hooks; registers no tools) |
| [`pi-ask-user`](./pi-ask-user/) | Minimal `ask_user` tool: one decision question per call with typed options, answered via Pi's built-in dialogs |
| [`pi-context-guard`](./pi-context-guard/) | `/context` command to surgically configure model `contextWindow` thresholds in `models.json` with multi-select TUI; the system prompt names the session file so details dropped by compaction stay searchable |
| [`pi-codemode-only`](./pi-codemode-only/) | Makes `codemode.mode: "only"` mean what it says on Pi ≥1.1.0: blocks direct tool calls (nested script calls pass) and rewrites the prompt's two direct-tool pointers to codemode (two event hooks; registers no tools) |

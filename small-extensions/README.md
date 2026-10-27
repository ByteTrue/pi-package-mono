# Small extensions

Tiny, standalone Pi extensions that live in this repo as source — **not published to npm**. Each subdirectory is one extension: a single TypeScript file (loaded by Pi via jiti, no build step), its tests, and a README. Anything that outgrows this form (npm distribution, a build step, bundled assets) belongs in [`packages/`](../packages/) instead.

Extensions here are intentionally not npm packages: no versioning ceremony for a few hundred lines, and the install channel is the scripts below. `npm install` still covers this directory (root `workspaces` includes `small-extensions/*`) only so CI typecheck and tests run over it — the `package.json` in each subdirectory is private and never published.

## Install

One Node script (Node 18+) downloads the extension files from this repo (`main` branch, GitHub raw) and copies them into `~/.pi/agent/extensions/`, overwriting whatever was there. It opens with an arrow-key checklist — `↑`/`↓` move, `space` toggles, `a` toggles all, `enter` installs — so a machine keeps only the extensions it wants. `--all` skips the menu and installs everything (for scripts, where there is no terminal).

Most extensions are pre-ticked, so plain `<enter>` installs them. `pi-context-guard` is `opt-in`: it starts unticked (marked in the menu) because it changes compaction behavior for the whole session. `space` ticks it; `--all` installs it too.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.mjs -o /tmp/install-small-extension.mjs
node /tmp/install-small-extension.mjs
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.mjs -OutFile "$env:TEMP\install-small-extension.mjs"
node "$env:TEMP\install-small-extension.mjs"
```

Re-running the script is the update path — there is no versioning and no pinning. Picking a subset never deletes anything: extensions you leave unticked simply stay as they are.

Restart or reload Pi afterwards; extensions in that directory load automatically.

## What is here

| Extension | What it does |
| --- | --- |
| [`pi-bash-timeout`](./pi-bash-timeout/) | Optional 300s default-and-cap for the built-in `bash`/`powershell` tools (two event hooks; registers no tools) |
| [`pi-ask-user`](./pi-ask-user/) | Minimal `ask_user` tool: 1–4 single- or multi-select decision questions per call with back-navigation, answered via Pi's built-in dialogs |
| [`pi-goal`](./pi-goal/) | Minimal `/goal`: one durable objective per session, continued automatically at Pi's settle boundary until the model calls `goal_done` with evidence. The model can draft the objective itself via `goal_start` (one command, two mutually exclusive tools, event hooks only) |
| [`pi-context-guard`](./pi-context-guard/) | Opt-in. Large-window models (>400k) compact at 400k instead of Pi's window−reserve default; the system prompt names the session file so details a compaction summary dropped stay searchable (two event hooks; registers no tools) |

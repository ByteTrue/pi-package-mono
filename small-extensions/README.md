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

## What is here

| Extension | What it does |
| --- | --- |
| [`pi-bash-timeout`](./pi-bash-timeout/) | Optional 300s default-and-cap for the built-in `bash`/`powershell` tools (two event hooks; registers no tools) |

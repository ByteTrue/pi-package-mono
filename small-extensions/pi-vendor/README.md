# pi-vendor (small extension)

Pi-specific `/vendor` interactive wizard **plus the `/vendor-ai` prompt command and relative bundled scripts** for managing `~/.pi/agent/models.json`.

This is the successor to the retired `@bytetrue/pi-vendor` npm package, kept in this repository rather than moved to Satchel. It is Pi-specific because it owns Pi's `models.json` transaction and model-registry refresh.

## Install

Use the repository's small-extension installer and select `pi-vendor`, or install all small extensions:

```bash
node /tmp/install-small-extension.mjs --all
```

The installer places:

- `pi-vendor.ts` in `~/.pi/agent/extensions/`;
- `vendor.mjs` and `vendor-shared.js` in `~/.pi/agent/extensions/pi-vendor/scripts/`.

Restart or `/reload` Pi, then:

- `/vendor` opens the interactive wizard.
- `/vendor-ai <request>` sends the embedded vendor prompt and your request to the Agent. The prompt resolves the bundled script's actual absolute path automatically.

No Skill directory, skill registration, or runtime prompt-file generation is involved.

Choose **Add provider** or **Add model**. The wizard supports official-catalog metadata, upstream model discovery, API/base URL and credential configuration, model defaults, and refresh after saving.

## Safety and behavior

- Reads and writes Pi's `models.json`; it does not use Satchel's MCP configuration.
- Uses revision checks and atomic writes so a concurrent edit is not silently overwritten.
- Existing provider/model edits are narrow; malformed configuration fails closed.
- Saving refreshes Pi's model registry and reports any rejection.
- `/vendor` requires interactive TUI mode. Non-interactive sessions should edit `models.json` directly.
- API keys remain local. Do not paste credentials into Agent conversations.

## Small-extension packaging

The executable extension entry is exactly `pi-vendor.ts`, including the `/vendor-ai` prompt text. Relative scripts live beside the installed extension. Neither has a build or runtime dependency on the retired package directory or other repository files.

It is a small extension (never published to npm) that drops straight into `~/.pi/agent/extensions/` and works without `npm install`: static runtime imports use only `node:*` built-ins, while Pi host modules (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) are resolved dynamically from the running Pi installation.

The former package's prompt is embedded in the extension, and its `vendor.mjs` CLI is included as a relative resource. `vendor.mjs` resolves `vendor-shared.js` inside its own scripts directory.

## Development

```bash
npm --workspace pi-vendor test
npm --workspace pi-vendor run typecheck
```

Tests exercise the single-file exports, `/vendor` and `/vendor-ai` commands, and bundled CLI: configuration transactions, model sources, catalog/discovery, and credential handling. Declaration files under `types/` preserve strict development-time types; they are not part of the installed artifact.

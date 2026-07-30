# @bytetrue/pi-vendor

AI-first provider and model configuration for the [Pi coding agent](https://pi.dev).

- The bundled `pi-vendor` skill handles routine `models.json` inspection, CRUD, discovery, and audits.
- Three read-only tools provide the active Pi catalog, safe `/models` discovery, and runtime validation.
- `/vendor` is a minimal cold-start TUI that adds one provider or one model per run.

Configuration path: `$PI_CODING_AGENT_DIR/models.json`, or `~/.pi/agent/models.json` by default.

[![npm version](https://img.shields.io/npm/v/@bytetrue/pi-vendor?style=flat-square)](https://www.npmjs.com/package/@bytetrue/pi-vendor)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](../../LICENSE)

## Install

```bash
pi install npm:@bytetrue/pi-vendor
```

Or install a local checkout:

```bash
pi install /absolute/path/to/pi-package-mono/packages/pi-vendor
```

Restart or reload Pi after installation. The package requires `@earendil-works/pi-coding-agent >=0.79.10`.

## Ask the AI

The package installs `skills/pi-vendor/SKILL.md`; Pi discovers it automatically. Ask naturally, for example:

- “Add `claude-opus-4-5` to provider `my-gateway` using Anthropic's official template.”
- “Discover the models exposed by `my-gateway`.”
- “Update this provider's base URL without changing its API key.”
- “Audit my Pi model configuration.”
- “Remove model `old-model` from provider `local`.”

The skill edits `models.json` with the AI's normal file tools. There is deliberately no general-purpose mutation tool: changes stay inspectable and narrow.

### API keys

Never paste an API key into chat. For key entry or rotation, the skill gives you a command for its bundled `set-api-key.mjs` script. The script:

- prompts in your terminal without echoing the key;
- updates only the selected provider's `apiKey`;
- writes atomically with file mode `0600`;
- never places the key in the command line or assistant response.

Keys are stored as literals in `models.json`, matching Pi's native configuration. When a key contains Pi metacharacters, the package writes Pi's escaped form (`$` as `$$`, leading `!` as `$!`) so it cannot be expanded or executed. Protect the file accordingly.

## Cold-start TUI

Run `/vendor` when no working model is available or when you prefer a manual path:

- **Add provider** — provider key → base URL → API format → API key → discover or enter one model → save.
- **Add model** — select an existing provider → discover or enter one model → save.

Each run adds exactly one provider/model and ends. Run `/vendor` again for another. Model candidate lists show at most ten rows; use `←`/`→` to page and `↑`/`↓` to move.

`Esc` cancels without writing. Successful saves use an atomic `0600` write, refresh Pi's active model registry, and report any runtime validation error.

## Read-only AI tools

| Tool | Purpose |
|---|---|
| `vendor_catalog_search` | Search credential-free templates from the active Pi installation. |
| `vendor_discover` | Resolve one configured provider safely and return upstream `/models` ids only. |
| `vendor_validate` | Refresh the running Pi registry and report whether the current `models.json` is valid. |

Discovery accepts only HTTP(S), rejects redirects and credential-bearing URLs, enforces a 15-second deadline and 2 MiB decoded-body limit, and preflights command-backed credentials before any privileged operation.

Tool output never includes configured API keys. Catalog results are closed, allowlisted DTOs without routing credentials or unknown passthrough fields.

## Development

```bash
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor pack --dry-run
```

The package is loaded from TypeScript source through Pi; it has no build step or generated browser assets.

Set `PI_CODING_AGENT_DIR` to an isolated directory for tests or smoke runs. Tests must not read or write the user's Pi configuration.

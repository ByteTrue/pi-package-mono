# @bytetrue/pi-vendor

AI-first provider and model configuration for the [Pi coding agent](https://pi.dev).

- The bundled `pi-vendor` skill handles routine `models.json` inspection, CRUD, discovery, and audits.
- A bundled Node script provides catalog lookup, `/models` discovery, local linting, and secret entry only when the skill invokes it.
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

Never paste an API key into chat. For key entry or rotation, the skill gives you a command for its bundled `vendor.mjs set-key` command. The script:

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

## Bundled script

The skill invokes one on-demand script instead of registering permanent AI tools:

| Command | Purpose |
|---|---|
| `vendor.mjs catalog <query>` | Search credential-free templates from the active Pi installation. |
| `vendor.mjs discover <provider> [configured-model]` | Probe the provider default route or one configured model's effective OpenAI/Anthropic/Google route; return listed ids only. |
| `vendor.mjs lint` | Check JSON shape and duplicate model ids without starting Pi. |
| `vendor.mjs set-key <provider>` | Prompt the user privately and update one key atomically. |

Discovery uses protocol-specific model-list URLs, authentication, and response shapes for OpenAI-compatible, Anthropic Messages, and Google Generative AI routes. It accepts only HTTP(S), rejects redirects and credential-bearing URLs, enforces a 15-second deadline and 2 MiB decoded-body limit, and never outputs configured credentials. Results are positive evidence only: an unlisted id is not proof that the upstream cannot serve it. `lint` is deliberately local; reload Pi and select the model when runtime confirmation is required.

## Development

```bash
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor pack --dry-run
```

The package is loaded from TypeScript source through Pi; it has no build step or generated browser assets.

Set `PI_CODING_AGENT_DIR` to an isolated directory for tests or smoke runs. Tests must not read or write the user's Pi configuration.

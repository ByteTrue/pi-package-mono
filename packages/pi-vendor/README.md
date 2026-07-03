# @bytetrue/pi-vendor

`/vendor` wizard for managing custom providers in `~/.pi/agent/models.json` — the [pi coding agent](https://pi.dev)'s provider config file.

[![npm version](https://img.shields.io/npm/v/@bytetrue/pi-vendor?style=flat-square)](https://www.npmjs.com/package/@bytetrue/pi-vendor)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](../../LICENSE)

[Features](#features) • [Install](#install) • [Usage](#usage) • [Model enrichment](#model-enrichment)

## Features

- **Provider drafting** — edit a provider in memory, save to `models.json` only when ready
- **Model management** — add models manually, import from OpenAI-compatible `/models` endpoints, or match against the installed pi official catalog
- **Fuzzy search** — quickly find providers and models by name
- **Safe writes** — all edits stay in memory until explicit save; no partial writes to disk

## Install

```bash
pi install /absolute/path/to/pi-package-mono/packages/pi-vendor
```

## Usage

Run `/vendor` in pi to open the provider management wizard:

1. **Select a provider** from the list (or create a new one)
2. **Edit** provider fields: name, API type, base URL, API key, headers
3. **Manage models** — add/edit/remove models, or import from a `/models` endpoint
4. **Save** — writes the provider back to `~/.pi/agent/models.json`

After saving, open `/model` in pi to refresh the available model list.

## Model enrichment

When adding models (manually or via `/models` import), pi-vendor enriches each model entry by:

1. Checking the **installed pi official catalog** first — if a matching template exists, it's used as the base
2. Falling back to **local templates** bundled with the extension for common providers (Anthropic, OpenAI, etc.)
3. Applying **safe defaults** for any remaining gaps

This means imported models get proper `api`, `reasoning`, `input`, `cost`, and `contextWindow` fields without manual configuration.

## Environment

Set `PI_CODING_AGENT_DIR` to redirect the agent directory (useful in tests or backup workflows). Defaults to `~/.pi/agent`.

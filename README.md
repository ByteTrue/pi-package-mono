# pi-package-mono

Personal [pi coding agent](https://pi.dev) extensions as an npm workspaces monorepo. Each package loads as TypeScript source via jiti — no build step required.

[Features](#packages) • [Local development](#local-development) • [Packages](#packages)

## Packages

| Package | Description |
|---|---|
| [`@bytetrue/pi-web-search`](packages/pi-web-search) | `web_search` + `web_fetch` tools with zero-config Exa MCP free search, keyless Bing fallback, self-hosted SearXNG, and pluggable providers (Bocha, Tavily, Exa, Brave, Jina, Firecrawl). |
| [`@bytetrue/pi-vendor`](packages/pi-vendor) | `/vendor` wizard for managing custom providers in `~/.pi/agent/models.json` — provider drafting, model enrichment, and `/models` import. |
| [`@bytetrue/pi-image-gen`](packages/pi-image-gen) | `image_generate` tool and `/image-gen` settings command for OpenAI, Gemini, Qwen-Image, Ark, OpenRouter, and compatible gateways. |

## Local development

```bash
# Install a package by local path (no npm publish needed)
pi install /absolute/path/to/pi-package-mono/packages/pi-web-search

# Or mount an extension for a quick trial run
pi -e /absolute/path/to/pi-package-mono/packages/pi-web-search

# Try image generation locally
pi install /absolute/path/to/pi-package-mono/packages/pi-image-gen
```

Run tests across all packages:

```bash
npm test
```

Run tests for a specific package:

```bash
npm --workspace @bytetrue/pi-web-search test

npm --workspace @bytetrue/pi-image-gen test
```

# pi-package-mono

Personal [pi coding agent](https://pi.dev) extensions as an npm workspaces monorepo. Most packages load TypeScript source via jiti; `pi-image-gen` publishes built `dist` files because its bundled Skill CLI shares the same core.

[Features](#packages) • [Local development](#local-development) • [Packages](#packages)

## Packages

| Package | Description |
|---|---|
| [`@bytetrue/pi-web-search`](packages/pi-web-search) | `web_search` + `web_fetch`, complete `/web` TUI setup, zero-config Exa MCP free search, explicit Bing/SearXNG/Bocha alternatives, and no implicit cross-provider fallback. |
| [`@bytetrue/pi-vendor`](packages/pi-vendor) | AI-first `models.json` management: bundled Skill + on-demand script, with `/vendor` as a minimal cold-start wizard. |
| [`@bytetrue/pi-image-gen`](packages/pi-image-gen) | Complete `/image-gen` TUI setup plus an on-demand Skill/CLI for OpenAI, Gemini, Qwen-Image, Ark, OpenRouter, and compatible gateways; no permanent Agent tool. |
| [`@bytetrue/pi-background-terminal`](packages/pi-background-terminal) | `background_run`/`background_status`/`background_kill` plus a `/background` task menu — independent tools, does not override `bash`. |
| [`@bytetrue/pi-vision`](packages/pi-vision) | `image_ask` + `/vision`: let a text-only model query local images or opt in to automatic attachment analysis through a vision-capable model from `models.json`. |

## Local development

```bash
# Install a package by local path (no npm publish needed)
pi install /absolute/path/to/pi-package-mono/packages/pi-web-search

# Or mount an extension for a quick trial run
pi -e /absolute/path/to/pi-package-mono/packages/pi-web-search

# Try image generation locally (its extension and Skill CLI load dist)
npm --workspace @bytetrue/pi-image-gen run build
pi install /absolute/path/to/pi-package-mono/packages/pi-image-gen

# Try background terminal locally
pi install /absolute/path/to/pi-package-mono/packages/pi-background-terminal

# Try vision locally
pi install /absolute/path/to/pi-package-mono/packages/pi-vision
```

Run tests across all packages:

```bash
npm test
```

Run tests for a specific package:

```bash
npm --workspace @bytetrue/pi-web-search test

npm --workspace @bytetrue/pi-image-gen test

npm --workspace @bytetrue/pi-background-terminal test

npm --workspace @bytetrue/pi-vision test
```

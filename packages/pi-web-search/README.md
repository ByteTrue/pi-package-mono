# @bytetrue/pi-web-search

`web_search` + `web_fetch` for the [pi coding agent](https://pi.dev) — same two-tool surface as Claude Code / Codex CLI.

[![npm version](https://img.shields.io/npm/v/@bytetrue/pi-web-search?style=flat-square)](https://www.npmjs.com/package/@bytetrue/pi-web-search)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](../../LICENSE)

[Tools](#tools) • [Install](#install) • [Configure](#configure) • [Fallback](#automatic-fallback) • [Proxy](#proxy-support)

- **Zero config.** Default provider is **Exa MCP free** (free, no API key) and returns clean result URLs. **Bing** remains available as a keyless fallback that works well in mainland China.
- **Pluggable.** Configure **SearXNG** (self-hosted URL) or a key-backed provider for higher reliability: **Bocha 博查 (China), Tavily, Exa, Brave, Jina, Firecrawl**.

## Tools

| Tool | What it does |
|---|---|
| `web_search` | Search the web. Args: `query`, optional `max_results` (1–10, default 5). |
| `web_fetch` | Fetch a URL and return extracted text. Args: `url`, optional `raw`. Blocks private/loopback hosts; rejects decoded response bodies over 10 MiB; truncates large outputs within that budget to a temp file. |

## Install

```bash
pi install /absolute/path/to/pi-package-mono/packages/pi-web-search
```

> [!IMPORTANT]
> If you previously used another web package (e.g. `@juicesharp/rpiv-web-tools`), remove it first — both register `web_search`/`web_fetch` and the names would collide.

## Configure (optional)

Run `/web` to pick a provider, enter its API key, or **set an HTTP proxy** (the last entry in the picker). Selecting a provider that's **already configured** (or keyless) activates it immediately — no key prompt. `/web --show` prints the current config including the active proxy.

Keys can also come from environment variables (env wins over config):

| Provider | Env var | Roles | Notes |
|---|---|---|---|
| Exa MCP free | — (keyless, default) | search | hosted Exa MCP search, no API key |
| Bing | — (keyless) | search | scrapes bing.com; **reachable from mainland China without a proxy** |
| SearXNG | `SEARXNG_URL` | search | self-hosted; `/web` prompts for the base URL |
| Bocha 博查 | `BOCHA_API_KEY` | search | China AI-search API, LLM-optimized, domestic/compliant |
| Tavily | `TAVILY_API_KEY` | search + fetch | |
| Exa | `EXA_API_KEY` | search + fetch | |
| Brave | `BRAVE_SEARCH_API_KEY` | search | |
| Jina | `JINA_API_KEY` | search + fetch (reader) | |
| Firecrawl | `FIRECRAWL_API_KEY` | search + scrape | |

**Mainland China without a proxy:** select **Bing** (free, no key) via `/web`, or **Bocha 博查** for a reliable LLM-optimized domestic API (`/web` → enter key).

Config lives at `~/.pi/byte-pi-web/config.json` (override the base dir with `PI_CONFIG_DIR`):

```json
{
  "provider": "exa-free",
  "proxy": "http://127.0.0.1:7890",
  "apiKeys": { "tavily": "tvly-...", "exa": "..." }
}
```

> [!NOTE]
> `proxy` applies to **all** web fetches. Keep it when your selected provider or fetched URLs require a proxy; Bing often works without one in mainland China.

When a key-backed provider with a native fetch endpoint is active (Tavily, Exa, Jina, Firecrawl), `web_fetch` uses it; otherwise it falls back to a built-in, keyless HTML→text fetcher.

## Automatic fallback

When the active search provider fails (error, rate-limit) or returns nothing, `web_search` automatically tries the other **available** providers — keyless ones (Exa MCP free, Bing, and SearXNG only when a URL is configured) plus any keyed ones you've configured — in order, and returns the first that yields results. The returned tool content and details report which provider actually answered and what it fell back from. Disable with `"autoFallback": false` in the config.

`web_fetch` similarly falls back to the built-in HTML extractor if a keyed provider's native fetch fails.

## Proxy support

Node's global `fetch` does **not** honor `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` by default. In a region-restricted network this shows up as: `web_fetch` of a reachable site works, but `web_search` fails — because the selected provider's host is only reachable through your proxy, and `fetch` bypasses it.

Set an explicit proxy in the config — the most reliable option, independent of how pi was launched:

```json
{ "proxy": "http://127.0.0.1:7890" }
```

On load, provider/API fetches use undici and honor `NO_PROXY`. Generic `web_fetch` sends arbitrary public targets through the selected per-protocol proxy directly (it intentionally does not let `NO_PROXY` bypass the SSRF-safe transport). If config `proxy` is unset, `HTTP_PROXY`, `HTTPS_PROXY`, then `ALL_PROXY` are used. Set `BYTE_PI_WEB_NO_PROXY=1` to disable proxying entirely.

## Live provider tests

Copy `live.e2e.example.json` to `live.e2e.local.json` and fill any provider keys / SearXNG URL you want to test. Missing providers are skipped; keyless Exa MCP free and Bing run by default.

```bash
npm run test:e2e --workspace @bytetrue/pi-web-search
```

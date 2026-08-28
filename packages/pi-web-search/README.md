<p align="center">
  <img src="./docs/banner.webp" alt="A web radar selecting a source and returning a guarded document" width="100%">
</p>

<h1 align="center">@bytetrue/pi-web-search</h1>

<p align="center">Search the current web and fetch public pages through explicit, bounded routes.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bytetrue/pi-web-search"><img src="https://img.shields.io/npm/v/@bytetrue/pi-web-search?style=flat-square" alt="npm version"></a>
</p>

Zero-config search works immediately through Exa MCP free. `/web` adds provider, API-key, SearXNG, and proxy configuration without requiring manual JSON edits.

## Install

```bash
pi install npm:@bytetrue/pi-web-search
```

Restart or reload Pi, then ask it to search the web. Run `/web` only when you want to change provider or network settings.

> [!IMPORTANT]
> Remove any extension that already registers `web_search` or `web_fetch`; Pi tool names must be unique.

## Tools

### `web_search`

| Argument | Required | Meaning |
| --- | --- | --- |
| `query` | Yes | Search text |
| `max_results` | No | 1–10 results; default 5 |

Search follows the provider chain configured in `/web`: the first provider is tried first, then configured fallbacks after provider creation, request, or timeout failures. User cancellation stops the whole chain; an empty successful result does not trigger fallback.

### `web_fetch`

| Argument | Required | Meaning |
| --- | --- | --- |
| `url` | Yes | Public HTTP(S) URL |
| `raw` | No | Return raw HTML instead of extracted text |

Search-provider choice never changes fetch routing. Every URL uses the same generic transport with redirect revalidation, SSRF checks, text-only enforcement, and a 10 MiB decoded-body limit. Large accepted text is truncated for context and saved to a temporary file for later reading.

## Configure with `/web`

The TUI can select an active provider, configure an ordered fallback chain, enter provider keys, set a SearXNG base URL, and configure an HTTP proxy. `/web --show` reports the provider chain with credentials masked. The API-key field is visible while typing; prefer the provider's environment variable when sharing or recording your terminal.

| Provider | Environment variable | Notes |
| --- | --- | --- |
| Exa MCP free | — | Keyless default |
| Bing | — | Keyless; useful in mainland China without a proxy |
| SearXNG | `SEARXNG_URL` | Self-hosted base URL |
| Bocha 博查 | `BOCHA_API_KEY` | China AI-search API |
| Tavily | `TAVILY_API_KEY` | Search API |
| Exa | `EXA_API_KEY` | Search API |
| Brave | `BRAVE_SEARCH_API_KEY` | Search API |
| Jina | `JINA_API_KEY` | Search API |
| Firecrawl | `FIRECRAWL_API_KEY` | Search API |

Provider API-key and base-URL environment variables override stored provider values; a configured proxy overrides proxy environment variables. Configuration lives at `~/.pi/byte-pi-web/config.json`; set `PI_CONFIG_DIR` to move the base directory. Writes are atomic with mode `0600`, and malformed JSON is never overwritten.

## Proxy behavior

Configure a proxy through `/web`, or set `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` before starting Pi. Provider requests honor `NO_PROXY`.

The dispatcher is package-scoped and never changes Node's process-global dispatcher. Arbitrary `web_fetch` targets intentionally do not use `NO_PROXY` to escape the guarded route. Set `BYTE_PI_WEB_NO_PROXY=1` to disable proxy use for this package.

Direct fetches block private, loopback, link-local, metadata, and other non-public destinations after local DNS resolution and at redirect/connect time. With an explicit proxy, local/private hostnames and IP literals remain blocked while the proxy becomes the trusted boundary for target DNS resolution.

<details>
<summary>Optional configuration shape</summary>

```json
{
  "providers": ["exa-free", "bing"],
  "proxy": "http://127.0.0.1:7890",
  "apiKeys": { "tavily": "tvly-..." },
  "baseUrls": { "searxng": "http://127.0.0.1:8080" }
}
```

The `/web` flow is preferred. Only `providers` is read; a legacy singular `provider` field is ignored.

</details>

## Development

```bash
npm --workspace @bytetrue/pi-web-search test
npm --workspace @bytetrue/pi-web-search run typecheck
npm --workspace @bytetrue/pi-web-search pack --dry-run
```

Live provider tests are opt-in:

```bash
npm --workspace @bytetrue/pi-web-search run test:e2e
```

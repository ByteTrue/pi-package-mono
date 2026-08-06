# @bytetrue/pi-web-search

`web_search` + `web_fetch` for the [Pi coding agent](https://pi.dev), with a complete `/web` configuration flow.

- **Zero config:** Exa MCP free is the default search provider.
- **Regional choices:** keyless Bing works well in mainland China; Bocha is available for domestic API search.
- **Explicit behavior:** one `web_search` call contacts exactly one provider. A failure never silently sends the same query elsewhere.
- **Safe fetch:** every `web_fetch` uses one SSRF-safe generic transport with redirect revalidation and a 10 MiB decoded-body limit.

## Install

```bash
pi install npm:@bytetrue/pi-web-search
```

If another extension registers `web_search` or `web_fetch`, remove it first to avoid tool-name collisions.

## Configure in Pi

Run `/web`. The TUI lets you:

- choose any search provider;
- enter its API key when required;
- configure a SearXNG base URL;
- configure the package HTTP proxy.

Selecting an already configured or keyless provider activates it immediately. `/web --show` reports the active provider, proxy, and masked key status.

No GitHub documentation or manual config editing is required for normal setup.

| Provider | Environment variable | Notes |
| --- | --- | --- |
| Exa MCP free | — | keyless default |
| Bing | — | keyless; reachable from mainland China without a proxy |
| SearXNG | `SEARXNG_URL` | self-hosted; `/web` prompts for the URL |
| Bocha 博查 | `BOCHA_API_KEY` | China AI-search API |
| Tavily | `TAVILY_API_KEY` | search |
| Exa | `EXA_API_KEY` | search |
| Brave | `BRAVE_SEARCH_API_KEY` | search |
| Jina | `JINA_API_KEY` | search |
| Firecrawl | `FIRECRAWL_API_KEY` | search |

Environment variables take precedence over stored keys. Config lives at `~/.pi/byte-pi-web/config.json`; set `PI_CONFIG_DIR` to override the base directory. The file is written atomically with mode `0600`, and `/web` refuses to overwrite malformed JSON.

## Tools

### `web_search`

Arguments:

- `query` — required search text;
- `max_results` — optional integer from 1 to 10, default 5;
- `provider` — optional explicit provider for this one call.

When `provider` is omitted, the `/web` active provider is used. Each call has a 15-second provider deadline, a 2 MiB provider-response limit, per-field UTF-8 limits, and a 64 KiB aggregate result limit.

There is no implicit fallback. If the selected provider fails, the error lists other configured provider ids; the agent may retry by making a new tool call with an explicit `provider`. This keeps privacy, cost, and latency visible.

### `web_fetch`

Arguments:

- `url` — required public `http(s)` URL;
- `raw` — optional; return raw HTML instead of extracted text.

Search-provider choice never changes fetch routing. Both raw and extracted fetches use the package's generic transport, which:

- rejects credentials in URLs;
- blocks private, loopback, link-local, metadata, and other non-public targets after local DNS resolution on direct routes;
- revalidates every redirect;
- when an explicit proxy is configured, still rejects local/private hostnames and IP literals, while the proxy becomes the trusted boundary for target DNS resolution;
- rejects non-text/binary content;
- rejects decoded bodies over 10 MiB;
- truncates large accepted text to Pi's context budget and saves the full accepted content to a temp file.

## Proxy support

Node's global `fetch` does not automatically honor proxy environment variables. Configure a proxy through `/web`, or set `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` before starting Pi.

The proxy dispatcher is package-scoped; the extension never changes the process-global dispatcher. Provider requests honor `NO_PROXY`. Arbitrary `web_fetch` targets intentionally do not use `NO_PROXY` to bypass the SSRF-safe route. Set `BYTE_PI_WEB_NO_PROXY=1` to disable proxy use.

## Optional file shape

The TUI owns normal setup. For automation, the resulting file is small:

```json
{
  "provider": "exa-free",
  "proxy": "http://127.0.0.1:7890",
  "apiKeys": { "tavily": "tvly-..." },
  "baseUrls": { "searxng": "http://127.0.0.1:8080" }
}
```

Legacy `autoFallback` is ignored and removed on the next `/web` save.

## Development

```bash
npm --workspace @bytetrue/pi-web-search test
npm --workspace @bytetrue/pi-web-search run typecheck
npm --workspace @bytetrue/pi-web-search pack --dry-run
```

Live provider tests are opt-in:

```bash
npm run test:e2e --workspace @bytetrue/pi-web-search
```

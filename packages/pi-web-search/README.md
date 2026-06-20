# @bytetrue/pi-web-search

`web_search` + `web_fetch` for the [pi coding agent](https://pi.dev) — same two-tool
surface as Claude Code / Codex CLI.

- **Zero config.** The default provider is **Bing** (free, no API key, no account)
  — scraped from `bing.com`, and reachable from mainland China without a proxy.
  **DuckDuckGo** is also available as a keyless option.
- **Pluggable.** Configure a key-backed provider for higher reliability:
  **Bocha 博查 (China), Tavily, Exa, Brave, Jina, Firecrawl**.

## Tools

| Tool | What it does |
|---|---|
| `web_search` | Search the web. Args: `query`, optional `max_results` (1–10, default 5). |
| `web_fetch` | Fetch a URL and return extracted text. Args: `url`, optional `raw`. Blocks private/loopback hosts; truncates large pages to a temp file. |

## Install

```bash
pi install /absolute/path/to/pi-package-mono/packages/pi-web-search
```

> If you previously used another web package (e.g. `@juicesharp/rpiv-web-tools`),
> remove it first — both register `web_search`/`web_fetch` and the names would collide.

## Configure (optional)

Run `/web` to pick a provider, enter its API key, or **set an HTTP proxy** (the
last entry in the picker). Selecting a provider that's **already configured**
(or keyless) activates it immediately — no key prompt. `/web --show` prints the
current config including the active proxy. Keys can also come from environment
variables (env wins over config):

| Provider | Env var | Roles | Notes |
|---|---|---|---|
| Bing | — (keyless, default) | search | scrapes bing.com; **reachable from mainland China without a proxy** |
| DuckDuckGo | — (keyless) | search | needs to reach duckduckgo.com (proxy in CN) |
| Bocha 博查 | `BOCHA_API_KEY` | search | China AI-search API, LLM-optimized, domestic/compliant |
| Tavily | `TAVILY_API_KEY` | search + fetch | |
| Exa | `EXA_API_KEY` | search + fetch | |
| Brave | `BRAVE_SEARCH_API_KEY` | search | |
| Jina | `JINA_API_KEY` | search + fetch (reader) | |
| Firecrawl | `FIRECRAWL_API_KEY` | search + scrape | |

**Mainland China without a proxy:** select **Bing** (free, no key) via `/web`, or
**Bocha 博查** for a reliable LLM-optimized domestic API (`/web` → enter key).

Config lives at `~/.pi/byte-pi-web/config.json` (override the base dir with `PI_CONFIG_DIR`):

```json
{
  "provider": "bing",
  "proxy": "http://127.0.0.1:7890",
  "apiKeys": { "tavily": "tvly-...", "exa": "..." }
}
```

> `proxy` applies to **all** web fetches. Bing works without a proxy in mainland
> China, so omit `proxy` if you don't need it; keep it if you also rely on
> DuckDuckGo or on fetching otherwise-blocked URLs.

When a key-backed provider with a native fetch endpoint is active (Tavily, Exa,
Jina, Firecrawl), `web_fetch` uses it; otherwise it falls back to a built-in,
keyless HTML→text fetcher.

## Automatic fallback

When the active search provider fails (error, rate-limit) or returns nothing,
`web_search` automatically tries the other **available** providers — keyless ones
(Bing, DuckDuckGo) plus any keyed ones you've configured — in order, and returns
the first that yields results. No manual `/web` switching needed. The result
details report which `backend` actually answered (and `fellBackFrom` if it fell
back). Disable with `"autoFallback": false` in the config.

`web_fetch` similarly falls back to the built-in HTML extractor if a keyed
provider's native fetch fails.

## Proxy support

Node's global `fetch` does **not** honor `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`
by default. In a region-restricted network this shows up as: `web_fetch` of a
reachable site works, but `web_search` fails — because the search backend's host
(e.g. `duckduckgo.com`) is only reachable through your proxy, and `fetch`
bypasses it. A TUN-mode or system proxy often sets no env var at all, so relying
on env vars isn't enough.

Set an explicit proxy in the config — the most reliable option, independent of
how pi was launched:

```json
{ "proxy": "http://127.0.0.1:7890" }
```

On load the package routes all fetches through it via undici (`NO_PROXY` /
localhost endpoints bypass it). If `proxy` is unset it falls back to the
`HTTP(S)_PROXY` env vars. Set `BYTE_PI_WEB_NO_PROXY=1` to disable entirely.

## DuckDuckGo caveats

DuckDuckGo has no official API; this scrapes its non-JS HTML endpoints
(`lite.duckduckgo.com` / `html.duckduckgo.com`) like the community-standard
`ddgs` library. It throttles after roughly 20–30 searches/min per IP and can
break on markup changes. The provider retries with backoff across both
endpoints and surfaces a clear, actionable error on rate-limit. For heavy use,
configure a key-backed provider via `/web`.

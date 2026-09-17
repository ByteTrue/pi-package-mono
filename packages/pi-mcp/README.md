# @bytetrue/pi-mcp

Minimal MCP (Model Context Protocol) adapter for the [pi coding agent](https://pi.dev). One proxy tool instead of hundreds of tool definitions; tool metadata is cached to disk so discovery works without live server connections; servers connect lazily and disconnect when idle.

Context management over feature breadth: the core design (proxy tool, metadata cache, lazy lifecycle, output guard) is ported from [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) (MIT — see NOTICE), which itself depends only on registry-published `@modelcontextprotocol/client`/`core` `2.0.0`. What's deliberately absent: OAuth flows, MCP UI, elicitation/sampling, scripting tools, plugin loaders, setup panels.

## Install

```sh
pi install npm:@bytetrue/pi-mcp
```

## Configuration

Same layered layout as pi-mcp-adapter / Claude Code / Cursor — an existing setup migrates by doing nothing:

| File | Purpose |
|------|---------|
| `~/.config/mcp/mcp.json` | User-global shared MCP config |
| `~/.agents/mcp.json` | User-global tool-agnostic MCP config |
| `~/.agents/mcp/mcp.json` | User-global tool-agnostic MCP config (nested) |
| `~/.pi/agent/mcp.json` | Pi global override (`$PI_CODING_AGENT_DIR/mcp.json`) |
| `.mcp.json` | Project-local shared MCP config |
| `.pi/mcp.json` | Pi project override |

Same-name servers in higher layers override lower ones; `disabled: true` in a higher layer disables an inherited server.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "directTools": ["search_repositories", "get_file_contents"],
      "searchKeywords": { "*": ["gh"] }
    },
    "docs": {
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  },
  "settings": {
    "idleTimeout": 10,
    "outputGuard": { "maxBytes": 51200, "maxLines": 2000, "detailsMaxBytes": 16384 }
  }
}
```

Server fields: `command`/`args`/`env`/`cwd` (stdio, `npx` commands are resolved to direct binaries — cached, with fallback to plain npx), `url` + `headers` (HTTP; Streamable HTTP with automatic SSE fallback on 404/405/406/415), `type`, `disabled`, `lifecycle` (`lazy` default | `eager`), `idleTimeout` (minutes; default 10, 0 disables — eager servers never idle-disconnect), `directTools` (`true` | `["tool_a"]`), `includeTools`/`excludeTools` (glob-capable), `searchKeywords`, `toolPrefix`.

## Usage

The extension registers one `mcp` tool (~200 tokens of schema):

| Operation | Call |
|-----------|------|
| Status | `mcp({})` |
| List server tools | `mcp({ server: "name" })` |
| Search tools | `mcp({ search: "words", limit?: 12, offset?: 0 })` |
| Regex search | `mcp({ search: "pattern", regex: true })` |
| Describe a tool | `mcp({ describe: "server_tool" })` |
| Call a tool | `mcp({ tool: "server_tool", args: { ... } })` |
| Server instructions | `mcp({ instructions: "name" })` |
| Connect/reconnect | `mcp({ connect: "name" })` |

`mcp({})` reports five honest states per server — `✓ connected` / `✗ failed (Ns ago, reason)` / `○ cached; not connected` / `○ not connected` / `⊘ disabled` — instead of one blurred "offline" line.

## Managing servers

**`/mcp` command** (Tab-completion for subcommands and server names):

| Command | Effect |
|---------|--------|
| `/mcp` (or `/mcp status`) | Five-state server listing |
| `/mcp reconnect [server]` | Reconnect one server or all enabled servers |
| `/mcp tools` | All tools across enabled servers (cache-backed) |
| `/mcp prompts` | All discovered prompts, grouped by server |
| `/mcp disable <server>` | Persist a `disabled: true` project override (`.pi/mcp.json`), then `/reload` |
| `/mcp enable <server>` | Remove the marker (or write `disabled: false` when a lower layer disables), then `/reload` |

**Interactive menu**: `/mcp` with no arguments in the TUI opens a native Pi dialog menu (`select`, `editor`, `input`, `notify`) — browse servers with live status and direct tool counts, toggle direct tools per server with `[●]`/`[○]`, enable/disable servers, reconnect individual or all servers, search tools, and browse prompts. Zero fragile custom terminal overlay diffing. All changes persist to `.pi/mcp.json` overrides.

**Footer status bar**: the TUI footer shows a live `mcp` slot, e.g. `2 servers enabled (1 connected) (1 disabled)`; `"compact"` renders `mcp:1/2`. Configure with `settings.mcpFooterStatus: "full" (default) | "compact" | "off"`. Disabled servers stay visible in status instead of vanishing from config, and are skipped by connect/search/direct-tools.

**Protocol tracing (opt-in)**: set `settings.trace: { enabled, file?, maxBytes?, maxEvents? }` (or `trace: true` per server) to record metadata-only JSONL protocol traces — direction, method, bytes, duration, secrets redacted — under `.pi/mcp-traces/` by default. Writers self-disable on any failure so tracing never changes MCP behavior.

Tool names match fuzzily across `-`/`_`; a miss returns ranked suggestions. Search ranks across name, server, description, and configured keywords, paginated via `offset`/`nextOffset`.

**Direct tools**: configure `directTools` per server (or `"directTools": true` in `settings`) to register chosen tools as real Pi tools with real schemas, skipping the search→describe hop. Each costs ~150–300 tokens in the system prompt, so it fits targeted sets of 5–20 tools; use include/exclude filters to trim noisy servers. Direct tools register statically from the disk metadata cache at load; on the first session after adding them, connect the server once (`mcp({ connect: "name" })`) to populate the cache, then `/reload`.

**Prompts**: servers advertising prompt templates become slash commands — `/mcp__<server>__<prompt>` — with positional and `key=value` arguments (bash-style quoting supported). Command definitions come from the metadata cache and refresh on reconnect.

## How it works

- **One proxy tool in context** instead of hundreds of definitions — the agent discovers tools on demand.
- **Disk metadata cache** (`~/.pi/agent/mcp-cache.json`, keyed by a config hash): search/list/describe work offline; a changed server config invalidates only that server's entry.
- **Lazy connections**: servers spawn on first tool call, disconnect after the idle timeout, and reconnect automatically on next use.
- **Output guard** (port of upstream's): text results capped at 50 KiB / 2,000 lines; oversize output spills to a private 0600 temp file whose path is returned for `read`/`grep`. Image blocks pass through untouched. `details.mcpResult` keeps raw JSON up to 16 KiB, then summarizes and spills. Disable with `"outputGuard": false` or `MCP_OUTPUT_GUARD=0`.
- **Failure backoff**: a server that just failed a connection is excluded from search for 60s instead of polluting results.

## Limitations (by design)

- No OAuth: HTTP servers authenticate with static `headers` only.
- No elicitation, sampling, MCP UI, or resource subscriptions — servers requiring them degrade gracefully.
- Direct tools don't hot-load; a `/reload` applies config or catalog changes.
- No config-writing UI: manage `mcp.json` files directly (or via your dotfiles).

## Development

```sh
npm --workspace @bytetrue/pi-mcp test       # vitest (includes real-stdio regression via npx)
npm --workspace @bytetrue/pi-mcp run typecheck
```

MIT. See [NOTICE](NOTICE) for upstream attribution.

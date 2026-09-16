// proxy.ts — the single `mcp` tool, following pi-mcp-adapter's proxy-modes.ts
// (MIT) operating table: status / list / ranked search with pagination /
// describe / call / instructions / connect. All discovery operations work
// from cached metadata; only call/connect touch live servers. The output
// guard is upstream's mcp-output-guard.
import type { ServerManager } from "./server-manager.js";
import type { McpSettings, ServerEntry, ToolMetadata } from "./types.js";
import { rankToolMatches, paginate, rankSuggestions, type SearchState } from "./search-ranking.js";
import { guardMcpOutput, resolveMcpOutputGuardOptions, guardedMcpDetails } from "./mcp-output-guard.js";
import { renderTsShape } from "./ts-shape.js";
import { getToolNameCandidates, resolveToolPrefix } from "./tool-naming.js";

export interface ProxyArgs {
  server?: string;
  search?: string;
  limit?: number;
  offset?: number;
  regex?: boolean;
  includeSchemas?: boolean;
  describe?: string;
  tool?: string;
  args?: Record<string, unknown>;
  instructions?: string;
  connect?: string;
}

const MAX_REGEX_SEARCH_QUERY_LENGTH = 256;

/** Upstream truncateAtWord (utils.ts): break at the last space past 60%. */
function truncateAtWord(text: string, target: number): string {
  if (!text || text.length <= target) return text;
  const truncated = text.slice(0, target);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > target * 0.6) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

export interface ProxyResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  details?: unknown;
}

export function createProxyHandler(options: {
  manager: ServerManager;
  settings: McpSettings;
  config: Record<string, ServerEntry>;
}): (args: ProxyArgs, signal?: AbortSignal) => Promise<ProxyResult> {
  const { manager, config } = options;

  // Search state assembled per call: cached metadata, failures, connections.
  const searchState = (): SearchState => {
    const toolMetadata = new Map<string, ToolMetadata[]>();
    for (const name of Object.keys(config)) {
      if (config[name]?.disabled === true) continue;
      const meta = manager.metadataFor(name);
      if (meta) toolMetadata.set(name, meta.tools);
    }
    const failureTracker = new Map<string, number>();
    const connectedServers = new Set<string>();
    for (const server of manager.servers.values()) {
      if (server.failedAt) failureTracker.set(server.name, server.failedAt);
      if (server.state) connectedServers.add(server.name);
    }
    return {
      toolMetadata,
      config: { mcpServers: config, settings: options.settings },
      failureTracker,
      connectedServers,
    };
  };

  const resolveTool = (name: string): { server: string; tool: ToolMetadata } | { suggestions: string[] } => {
    const state = searchState();
    for (const [serverName, tools] of state.toolMetadata.entries()) {
      const entry = config[serverName];
      const prefix = resolveToolPrefix(entry, options.settings.toolPrefix ?? "server");
      for (const tool of tools) {
        const candidates = getToolNameCandidates(tool.originalName, serverName, prefix);
        if (candidates.has(name)) return { server: serverName, tool };
      }
    }
    return { suggestions: rankSuggestions(state, name, 5) };
  };

  const disabledResult = (what: string, serverName: string): ProxyResult =>
    text(`Server "${serverName}" is disabled. Run /mcp enable ${serverName} and /reload to enable it, or edit mcp.json directly.`);

  const toolLine = (m: { server: string; tool: ToolMetadata }) => {
    const desc = m.tool.description ? ` — ${m.tool.description.split("\n")[0] ?? ""}` : "";
    return `${m.tool.name} [${m.server}]${desc}`;
  };

  return async (args: ProxyArgs, signal?: AbortSignal): Promise<ProxyResult> => {
    const guardOptions = resolveMcpOutputGuardOptions(options.settings);

    // ── status ──
    if (!args.server && !args.search && !args.describe && !args.tool && !args.instructions && !args.connect) {
      // Upstream executeStatus semantics: five states, honest tool counts.
      const rows = manager.status();
      const enabled = rows.filter((s) => !s.disabled);
      const connectedCount = enabled.filter((s) => s.connected).length;
      const totalTools = enabled.reduce((sum, s) => sum + s.toolCount, 0);
      const disabledCount = rows.length - enabled.length;
      const lines = rows.map((s) => {
        if (s.disabled) return `⊘ ${s.name} (disabled)`;
        if (s.connected) return `✓ ${s.name} (${s.toolCount} tools, connected)`;
        if (s.failed) return `✗ ${s.name} (failed ${s.failedAgeSeconds ?? 0}s ago${s.lastError ? `: ${s.lastError}` : ""})`;
        if (s.cached) return `○ ${s.name} (${s.toolCount} tools, cached; not connected)`;
        return `○ ${s.name} (not connected)`;
      });
      if (rows.length === 0) {
        return text("No MCP servers configured. Add servers to ~/.pi/agent/mcp.json, ~/.config/mcp/mcp.json, or .mcp.json (mcpServers: { name: { command, args } | { url } }).");
      }
      const header = `MCP: ${connectedCount}/${enabled.length} servers, ${totalTools} tools${disabledCount > 0 ? ` (${disabledCount} disabled)` : ""}`;
      return text([header, "", ...lines, "", `mcp({ server: "name" }) to list tools, mcp({ search: "..." }) to search`].join("\n"));
    }

    // ── connect / reconnect ──
    if (args.connect) {
      if (config[args.connect]?.disabled === true) return disabledResult("connect", args.connect);
      const state = await manager.connect(args.connect, signal);
      return text(`Connected ${args.connect}: ${state.tools.length} tools, ${state.prompts.length} prompts.`);
    }

    // ── list server (upstream executeList; search/call branch above when combined) ──
    if (args.server) {
      const listed = config[args.server];
      if (!listed) {
        throw new Error(`Server "${args.server}" not found. Use mcp({}) to see available servers.`);
      }
      if (listed.disabled === true) return disabledResult("server", args.server);
      // Cache-first (upstream executeList): never spawn a server from a
      // discovery operation; tell the caller how to connect instead.
      const meta = manager.metadataFor(args.server);
      const connected = manager.isConnected(args.server);
      if (!meta || meta.tools.length === 0) {
        if (connected) return text(`Server "${args.server}" has no tools.`);
        if (meta) return text(`Server "${args.server}" has no cached tools (not connected).`);
        return text(`Server "${args.server}" is configured but not connected. Use mcp({ connect: "${args.server}" }) or /mcp reconnect ${args.server} to retry.`);
      }
      const cachedNote = connected ? "" : " (lazy: tools from cache, not connected yet — mcp({ connect: \"name\" }) to connect)";
      const toolLines = meta.tools.map((t) => {
        const desc = truncateAtWord(t.description, 50);
        return `- ${t.name}${desc ? ` - ${desc}` : ""}`;
      });
      const promptLines = meta.prompts.map((p) => `  /${p.commandName} — ${(p.description ?? "").split("\n")[0] ?? ""}`);
      let instructionsText = "";
      if (meta.instructions) {
        const preview = truncateAtWord(meta.instructions, 300);
        instructionsText = `\n\nServer instructions:\n${preview}`;
        if (preview !== meta.instructions) {
          instructionsText += `\nUse mcp({ instructions: "${args.server}" }) for the full text.`;
        }
      }
      return text(
        [
          `${args.server} (${meta.tools.length} tools${cachedNote}):`,
          "",
          ...toolLines,
          ...(promptLines.length ? ["", "Prompts:", ...promptLines] : []),
          instructionsText,
        ].join("\n").trim(),
      );
    }

    // ── instructions (cache-first; discovery must not spawn servers) ──
    if (args.instructions) {
      const target = config[args.instructions];
      if (!target) throw new Error(`Server "${args.instructions}" not found. Use mcp({}) to see available servers.`);
      if (target.disabled === true) return disabledResult("instructions", args.instructions);
      const meta = manager.metadataFor(args.instructions);
      if (meta?.instructions) {
        return text(`${args.instructions} instructions:\n\n${meta.instructions}`);
      }
      if (manager.isConnected(args.instructions)) {
        return text(`Server "${args.instructions}" does not provide instructions.`);
      }
      return text(`No instructions cached for "${args.instructions}". Use mcp({ connect: "${args.instructions}" }) to connect and refresh.`);
    }

    // ── search (upstream executeSearch output contract) ──
    if (args.search !== undefined) {
      if (args.search.trim().length === 0) {
        throw new Error("Search query cannot be empty");
      }
      const serverFilter = args.server;
      if (serverFilter && !config[serverFilter]) {
        throw new Error(`Server "${serverFilter}" not found. Use mcp({}) to see available servers.`);
      }
      if (serverFilter && config[serverFilter]?.disabled === true) return disabledResult("search", serverFilter);
      const showSchemas = args.includeSchemas !== false;
      let matches: Array<{ server: string; tool: ToolMetadata; score: number }>;
      if (args.regex) {
        if (args.search.length > MAX_REGEX_SEARCH_QUERY_LENGTH) {
          throw new Error(`Regex query is too long; maximum length is ${MAX_REGEX_SEARCH_QUERY_LENGTH} characters.`);
        }
        let re: RegExp;
        try {
          re = new RegExp(args.search, "i");
        } catch {
          throw new Error(`Invalid regex: ${args.search}`);
        }
        const state = searchState();
        matches = [];
        for (const [serverName, tools] of state.toolMetadata.entries()) {
          if (serverFilter && serverName !== serverFilter) continue;
          for (const tool of tools) {
            if (re.test(tool.name) || re.test(tool.description)) matches.push({ server: serverName, tool, score: 0 });
          }
        }
      } else {
        matches = rankToolMatches(searchState(), args.search, serverFilter);
      }
      const page = paginate(matches, args.offset ?? 0, args.limit ?? 12);
      if (page.total === 0) {
        const msg = serverFilter ? `No tools matching "${args.search}" in "${serverFilter}"` : `No tools matching "${args.search}"`;
        return text(`${msg} Try fewer or different words, or regex: true.`);
      }
      const lines: string[] = [`Found ${page.total} tool${page.total === 1 ? "" : "s"} matching "${args.search}":`, ""];
      for (const match of page.items) {
        if (showSchemas) {
          lines.push(match.tool.name);
          lines.push(`  ${match.tool.description || "(no description)"}`);
          const shape = renderTsShape(match.tool.inputSchema);
          lines.push(shape === null
            ? `  Parameters: ${JSON.stringify(match.tool.inputSchema ?? { type: "object" })}`
            : `  Shape:\n${shape.split("\n").map((l) => `    ${l}`).join("\n")}`);
          lines.push("");
        } else {
          const desc = truncateAtWord(match.tool.description, 50);
          lines.push(`- ${match.tool.name}${desc ? ` - ${desc}` : ""}`);
        }
      }
      if (page.nextOffset !== null) {
        lines.push(`${page.items.length} of ${page.total} — offset: ${page.nextOffset} for more`);
      }
      return text(lines.join("\n").trim());
    }

    // ── describe (upstream output format) ──
    if (args.describe) {
      const resolved = resolveTool(args.describe);
      if ("server" in resolved) {
        let body = `Tool: ${resolved.tool.name}\nServer: ${resolved.server}\n\n${resolved.tool.description || "(no description)"}\n`;
        if (resolved.tool.inputSchema) {
          const shape = renderTsShape(resolved.tool.inputSchema);
          body += shape === null
            ? `\nParameters:\n${JSON.stringify(resolved.tool.inputSchema)}`
            : `\nShape:\n${shape}`;
        } else {
          body += `\nNo parameters defined.`;
        }
        return text(body);
      }
      const suggest = resolved.suggestions.length ? ` Did you mean: ${resolved.suggestions.join(", ")}` : "";
      throw new Error(`Tool "${args.describe}" not found. Use mcp({ search: "..." }) to search.${suggest}`);
    }

    // ── call ──
    if (args.tool) {
      const resolved = resolveTool(args.tool);
      let target: { server: string; tool: ToolMetadata };
      if ("server" in resolved) {
        target = resolved;
      } else if (resolved.suggestions.length === 1) {
        const again = resolveTool(resolved.suggestions[0]!);
        if ("server" in again) target = again;
        else throw new Error(`Tool not found: ${args.tool}`);
      } else {
        const suggest = resolved.suggestions.length
          ? resolved.suggestions.map((s) => `- ${s}`).join("\n")
          : "(no suggestions)";
        throw new Error(`Tool not found: ${args.tool}. Did you mean:\n${suggest}`);
      }
      const client = await manager.clientFor(target.server, signal);
      let result: { content?: unknown; isError?: boolean };
      try {
        result = (await client.callTool({ name: target.tool.originalName, arguments: args.args ?? {} })) as {
          content?: unknown;
          isError?: boolean;
        };
      } catch (error) {
        throw new Error(`MCP call ${target.tool.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const content = Array.isArray(result.content) ? result.content : [];
      const guarded = await guardMcpOutput(content as never, {
        ...guardOptions,
        rawMcpResult: result,
      });
      return {
        content: guarded.content,
        details: {
          mcpServer: target.server,
          mcpTool: target.tool.originalName,
          ...guardedMcpDetails(guarded),
        },
      };
    }

    throw new Error("Unreachable: unhandled mcp tool operation");
  };
}

function text(t: string): ProxyResult {
  return { content: [{ type: "text", text: t }] };
}

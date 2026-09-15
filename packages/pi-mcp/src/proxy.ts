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
  describe?: string;
  tool?: string;
  args?: Record<string, unknown>;
  instructions?: string;
  connect?: string;
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

  const toolLine = (m: { server: string; tool: ToolMetadata }) => {
    const desc = m.tool.description ? ` — ${m.tool.description.split("\n")[0] ?? ""}` : "";
    return `${m.tool.name} [${m.server}]${desc}`;
  };

  return async (args: ProxyArgs, signal?: AbortSignal): Promise<ProxyResult> => {
    const guardOptions = resolveMcpOutputGuardOptions(options.settings);

    // ── status ──
    if (!args.server && !args.search && !args.describe && !args.tool && !args.instructions && !args.connect) {
      const lines = manager.status().map((s) => {
        const state = s.connected ? "connected" : manager.metadataFor(s.name) ? "cached (offline)" : "not connected";
        const err = s.lastError ? ` — last error: ${s.lastError}` : "";
        return `${s.name}: ${state}, ${s.toolCount} tools${err}`;
      });
      if (lines.length === 0) {
        return text("No MCP servers configured. Add servers to ~/.pi/agent/mcp.json, ~/.config/mcp/mcp.json, or .mcp.json (mcpServers: { name: { command, args } | { url } }).");
      }
      return text(["MCP servers:", ...lines.map((l) => `- ${l}`)].join("\n"));
    }

    // ── connect / reconnect ──
    if (args.connect) {
      const state = await manager.connect(args.connect, signal);
      return text(`Connected ${args.connect}: ${state.tools.length} tools, ${state.prompts.length} prompts.`);
    }

    // ── list server ──
    if (args.server) {
      if (!config[args.server]) {
        throw new Error(`Unknown server: ${args.server}. Available: ${Object.keys(config).join(", ") || "(none)"}`);
      }
      // Connect if we have nothing cached for it; otherwise list from cache.
      let meta = manager.metadataFor(args.server);
      if (!meta) {
        const state = await manager.connect(args.server, signal);
        meta = { tools: state.tools, prompts: state.prompts, instructions: state.instructions };
      }
      const lines = meta.tools.map((t) => `  ${t.name} — ${(t.description ?? "").split("\n")[0] ?? ""}`);
      const promptLines = meta.prompts.map((p) => `  /${p.commandName} — ${(p.description ?? "").split("\n")[0] ?? ""}`);
      const instrPreview = meta.instructions ? `\nInstructions: ${meta.instructions.split("\n")[0] ?? ""}` : "";
      return text(
        [
          `${args.server}: ${meta.tools.length} tools${promptLines.length ? `, ${meta.prompts.length} prompts` : ""}${instrPreview}`,
          "Tools:",
          ...lines,
          ...(promptLines.length ? ["Prompts:", ...promptLines] : []),
        ].join("\n"),
      );
    }

    // ── instructions ──
    if (args.instructions) {
      if (!config[args.instructions]) throw new Error(`Unknown server: ${args.instructions}`);
      let meta = manager.metadataFor(args.instructions);
      if (!meta) {
        const state = await manager.connect(args.instructions, signal);
        meta = { tools: state.tools, prompts: state.prompts, instructions: state.instructions };
      }
      if (!meta.instructions) throw new Error(`Server ${args.instructions} provides no instructions.`);
      return text(meta.instructions);
    }

    // ── search ──
    if (args.search !== undefined && args.search !== "") {
      if (args.regex) {
        // Regex mode: literal substring/regex over cached tool names+descriptions, paginated without ranking.
        let re: RegExp;
        try {
          re = new RegExp(args.search, "i");
        } catch (error) {
          throw new Error(`Invalid regex: ${error instanceof Error ? error.message : String(error)}`);
        }
        const state = searchState();
        const hits: Array<{ server: string; tool: ToolMetadata }> = [];
        for (const [serverName, tools] of state.toolMetadata.entries()) {
          for (const tool of tools) {
            if (re.test(tool.name) || re.test(tool.description)) hits.push({ server: serverName, tool });
          }
        }
        const page = paginate(hits, args.offset ?? 0, args.limit ?? 12);
        return text(
          [
            `MCP tools matching /${args.search}/ (${page.items.length} of ${page.total}, offset ${args.offset ?? 0}):`,
            ...page.items.map((h) => `- ${toolLine(h)}`),
            ...(page.nextOffset !== null ? [`(more available — use offset: ${page.nextOffset})`] : []),
          ].join("\n"),
        );
      }
      const matches = rankToolMatches(searchState(), args.search);
      const page = paginate(matches, args.offset ?? 0, args.limit ?? 12);
      if (page.items.length === 0) {
        return text(`No MCP tools match "${args.search}". Try fewer or different words, or regex: true.`);
      }
      return text(
        [
          `MCP tools matching "${args.search}" (${page.items.length} of ${page.total}, offset ${args.offset ?? 0}):`,
          ...page.items.map((m) => `- ${toolLine(m)}`),
          ...(page.nextOffset !== null ? [`(more available — use offset: ${page.nextOffset})`] : []),
        ].join("\n"),
      );
    }

    // ── describe ──
    if (args.describe) {
      const resolved = resolveTool(args.describe);
      if ("server" in resolved) {
        const shape = renderTsShape(resolved.tool.inputSchema);
        const params = shape ?? JSON.stringify(resolved.tool.inputSchema ?? { type: "object" });
        return text(`${resolved.tool.name} [${resolved.server}]\n${resolved.tool.description}\n\nParameters: ${params}`);
      }
      const suggest = resolved.suggestions.length
        ? resolved.suggestions.map((s) => `- ${s}`).join("\n")
        : "(no suggestions)";
      throw new Error(`Tool not found: ${args.describe}. Did you mean:\n${suggest}`);
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

// index.ts — @bytetrue/pi-mcp extension entry: one `mcp` proxy tool, optional
// direct tools, /mcp__server__prompt slash commands, /mcp status command.
// Structure follows pi-mcp-adapter's index.ts (MIT) with the UI/OAuth/panel
// surface removed.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadMcpConfig } from "./config.js";
import { ServerManager, setGlobalManager, getGlobalManager } from "./server-manager.js";
import { createProxyHandler, type ProxyArgs } from "./proxy.js";
import { collectDirectTools, makeDirectToolExecute, jsonSchemaToParameters } from "./direct-tools.js";
import { resolveCachedPrompts, createPromptCommand, type PromptRuntime } from "./prompts.js";

const PROXY_TOOL_DESCRIPTION = `MCP gateway. Discover and call tools from configured MCP servers.
- Status: {}
- List server tools: { server: "name" }
- Search tools: { search: "words", limit?: 12, offset?: 0, regex?: false }
- Describe a tool: { describe: "server_tool" }
- Call a tool: { tool: "server_tool", args: { ... } }
- Server instructions: { instructions: "name" }
- Connect/reconnect: { connect: "name" }
Tool names match fuzzily across - and _; misses return suggestions.`;

export default function piMcpExtension(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  const config = loadMcpConfig(cwd);

  // Reuse a live manager across /reload when the merged config is identical;
  // otherwise spin up a fresh one (old one's idle timers die with its servers).
  const prev = getGlobalManager();
  const configChanged =
    !prev ||
    prev.servers.size !== Object.keys(config.mcpServers).length ||
    [...prev.servers.values()].some(
      (s) => JSON.stringify(s.entry) !== JSON.stringify(config.mcpServers[s.name]),
    );
  const manager =
    !configChanged && prev
      ? prev
      : new ServerManager({
          config: config.mcpServers,
          defaultIdleTimeoutSec: config.settings?.idleTimeout,
          globalPrefix: config.settings?.toolPrefix,
        });
  setGlobalManager(manager);

  const promptRuntime: PromptRuntime = {
    manager,
    config,
    promptMetadataLive: new Set(),
  };

  // ── the single proxy tool ──
  const proxy = createProxyHandler({
    manager,
    settings: config.settings ?? {},
    config: config.mcpServers,
  });

  pi.registerTool({
    name: "mcp",
    label: "MCP",
    description: PROXY_TOOL_DESCRIPTION,
    promptSnippet:
      "MCP gateway: mcp({ search: \"...\" }) to find tools, mcp({ tool: \"...\", args }) to call.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "List tools of one server" },
        search: { type: "string", description: "Ranked tool search (space-separated words)" },
        limit: { type: "number", description: "Search page size (default 12)" },
        offset: { type: "number", description: "Search page offset (default 0)" },
        regex: { type: "boolean", description: "Treat search as a regex" },
        describe: { type: "string", description: "Show one tool's description and parameters" },
        tool: { type: "string", description: "Call this tool (server-prefixed name)" },
        args: { type: "object", description: "Arguments for the tool call" },
        instructions: { type: "string", description: "Get a server's usage instructions" },
        connect: { type: "string", description: "Connect/reconnect a server" },
      },
      additionalProperties: false,
    } as never,
    async execute(_id, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      return (await proxy(params as ProxyArgs, signal)) as never;
    },
  });

  // ── direct tools from cached metadata ──
  const directSpecs = collectDirectTools(config, (server) => manager.metadataFor(server));
  for (const spec of directSpecs) {
    const execute = makeDirectToolExecute(manager, spec, config.settings ?? {});
    pi.registerTool({
      name: spec.name,
      label: spec.name,
      description: spec.description,
      parameters: jsonSchemaToParameters(spec.inputSchema) as never,
      async execute(_id, params, signal) {
        if (signal?.aborted) throw new Error("Aborted");
        return (await execute(params as Record<string, unknown>, signal)) as never;
      },
    });
  }
  if (directSpecs.length > 40) {
    console.warn(
      `[pi-mcp] ${directSpecs.length} direct tools registered — consider narrowing directTools config`,
    );
  }

  // ── prompt slash commands ──
  for (const metadata of resolveCachedPrompts(config)) {
    pi.registerCommand(
      metadata.commandName,
      createPromptCommand(pi, () => promptRuntime, metadata),
    );
  }

  // ── /mcp status command ──
  pi.registerCommand("mcp", {
    description: "MCP server status; reconnect with /mcp reconnect [server]",
    handler: async (args: string, ctx: ExtensionContext) => {
      const [sub, server] = args.trim().split(/\s+/);
      if (sub === "reconnect") {
        if (server) {
          const state = await manager.reconnect(server);
          const message = `Reconnected ${server}: ${state.tools.length} tools.`;
          if (ctx.ui) ctx.ui.notify(message, "info");
        } else {
          await Promise.allSettled([...manager.servers.keys()].map((n) => manager.reconnect(n)));
          if (ctx.ui) ctx.ui.notify("Reconnected all servers.", "info");
        }
        return;
      }
      const lines = manager.status().map((s) => {
        const state = s.connected ? "● connected" : s.lastError ? `✗ ${s.lastError}` : "○ cached/offline";
        return `  ${s.name}: ${state} (${s.toolCount} tools)`;
      });
      const message = ["MCP servers:", ...(lines.length ? lines : ["  (none configured)"])].join("\n");
      if (ctx.ui) ctx.ui.notify(message, "info");
    },
  });

  // ── lifecycle ──
  pi.on("session_start", async () => {
    // Eager servers connect now; lazy servers stay cold until first call.
    // After connecting, prompt commands may need (re)registration — but Pi
    // command registration happens at load; a /mcp reconnect refreshes state.
    const eager = [...manager.servers.values()].filter((s) => s.entry.lifecycle === "eager");
    await Promise.allSettled(eager.map((s) => manager.connect(s.name)));
    for (const s of eager) {
      if (manager.isConnected(s.name)) promptRuntime.promptMetadataLive.add(s.name);
    }
  });

  pi.on("session_shutdown", async (event: { reason?: string }) => {
    if (event?.reason === "reload") {
      // Live connections are pinned on globalThis and reused by the re-imported
      // module when config is unchanged — do not kill them here.
      return;
    }
    await manager.disconnectAll();
  });
}

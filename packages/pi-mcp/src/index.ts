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
import {
  allPromptsText,
  allToolsText,
  footerStatusText,
  mcpArgumentCompletions,
  serverStatusLines,
  writeProjectServerDisabledOverride,
} from "./commands.js";
import { runMcpMenu } from "./menu.js";

const PROXY_TOOL_DESCRIPTION = `MCP gateway. Discover and call tools from configured MCP servers.
- Status: {}
- List server tools: { server: "name" }
- Search tools: { search: "words", limit?: 12, offset?: 0, regex?: false, includeSchemas?: true }
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
  // A manager pinned by an older copy of this extension (e.g. a stale global
  // npm install loading before the local one — both share the globalThis
  // symbol) lacks newer methods and must be replaced wholesale.
  const prev = getGlobalManager();
  const prevUsable = !!prev && typeof prev.onStateChange === "function" && prev.managerVersion === 3;
  const configChanged =
    !prevUsable ||
    prev!.servers.size !== Object.keys(config.mcpServers).length ||
    [...prev!.servers.values()].some(
      (s) => JSON.stringify(s.entry) !== JSON.stringify(config.mcpServers[s.name]),
    );
  const manager =
    prevUsable && !configChanged
      ? prev!
      : new ServerManager({
          config: config.mcpServers,
          defaultIdleTimeoutMin: config.settings?.idleTimeout,
          globalPrefix: config.settings?.toolPrefix,
          traceSettings: config.settings?.trace,
        });
  setGlobalManager(manager);

  const promptRuntime: PromptRuntime = {
    manager,
    config,
    promptMetadataLive: new Set(),
  };

  // ── footer status bar (mcpFooterStatus) ──
  let footerCtx: ExtensionContext | null = null;
  const applyFooter = (): void => {
    if (!footerCtx?.ui) return;
    const text = footerStatusText(manager, config.settings?.mcpFooterStatus ?? "full");
    try {
      footerCtx.ui.setStatus("mcp", text);
    } catch {
      // Status UI must never affect connection behavior.
    }
  };
  manager.onStateChange(applyFooter);

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
        search: { type: "string", description: "Search tools by name/description" },
        limit: { type: "number", description: "Maximum search results to return (default: 12)" },
        offset: { type: "number", description: "Search result offset (default: 0)" },
        regex: { type: "boolean", description: "Treat search as regex (default: substring match)" },
        includeSchemas: { type: "boolean", description: "Include parameter schemas in search results (default: true)" },
        describe: { type: "string", description: "Tool name to describe (shows parameters)" },
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

  // ── /mcp command: status / reconnect / tools / prompts / enable / disable ──
  pi.registerCommand("mcp", {
    description: "MCP servers: status, reconnect, tools, prompts, enable/disable",
    getArgumentCompletions: (prefix: string) => mcpArgumentCompletions(prefix, config.mcpServers),
    handler: async (args: string, ctx: ExtensionContext) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const [sub, server] = parts;
      const rest = parts.slice(1).join(" ");
      const notify = (message: string, level: "info" | "error" = "info") => {
        if (ctx.ui) ctx.ui.notify(message, level);
      };

      if (sub === "reconnect") {
        if (server) {
          if (!config.mcpServers[server]) {
            notify(`Server "${server}" not found in effective config`, "error");
            return;
          }
          if (config.mcpServers[server].disabled === true) {
            notify(`Server "${server}" is disabled (run /mcp enable ${server}, then /reload)`, "error");
            return;
          }
          try {
            const state = await manager.reconnect(server);
            notify(`Reconnected ${server}: ${state.tools.length} tools.`);
          } catch (error) {
            notify(`Failed to reconnect ${server}: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
        } else {
          const results = await Promise.allSettled(
            [...manager.servers.values()].filter((s) => s.entry.disabled !== true).map((s) => manager.reconnect(s.name)),
          );
          const failed = results.filter((r) => r.status === "rejected").length;
          notify(failed > 0 ? `Reconnected all servers (${failed} failed).` : "Reconnected all servers.");
        }
        applyFooter();
        return;
      }

      if (sub === "tools") {
        notify(allToolsText(manager, config.mcpServers));
        return;
      }

      if (sub === "prompts") {
        notify(allPromptsText(manager, config.mcpServers));
        return;
      }

      if (sub === "enable" || sub === "disable") {
        const serverName = rest;
        if (!serverName) {
          notify(`Usage: /mcp ${sub} <server>`, "error");
          return;
        }
        if (!config.mcpServers[serverName]) {
          notify(`Server "${serverName}" not found in effective config`, "error");
          return;
        }
        try {
          const result = writeProjectServerDisabledOverride(process.cwd(), serverName, sub === "disable", config);
          notify(
            result.changed
              ? `${sub === "disable" ? "Disabled" : "Enabled"} server "${serverName}" in ${result.path} — run /reload to apply`
              : `Server "${serverName}" is already ${sub === "disable" ? "disabled" : "enabled"}`,
          );
        } catch (error) {
          notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }

      // default (and explicit "status"): TUI gets the native interactive menu;
      // print/json modes get the five-state text.
      if (ctx.hasUI && ctx.mode === "tui") {
        await runMcpMenu(manager, config, ctx);
        return;
      }
      const message = ["MCP servers:", ...(serverStatusLines(manager).map((l) => `  ${l}`))].join("\n");
      if (!manager.servers.size) notify("MCP servers: (none configured)");
      else notify(message);
    },
  });

  // ── lifecycle ──
  pi.on("session_start", async (_event, ctx) => {
    footerCtx = ctx;
    // Eager servers connect now; lazy servers stay cold until first call.
    // After connecting, prompt commands may need (re)registration — but Pi
    // command registration happens at load; a /mcp reconnect refreshes state.
    const eager = [...manager.servers.values()].filter((s) => s.entry.lifecycle === "eager");
    await Promise.allSettled(eager.map((s) => manager.connect(s.name)));
    for (const s of eager) {
      if (manager.isConnected(s.name)) promptRuntime.promptMetadataLive.add(s.name);
    }
    applyFooter();
  });

  pi.on("session_shutdown", async (event: { reason?: string }, ctx: ExtensionContext) => {
    if (event?.reason === "reload") {
      // Live connections are pinned on globalThis and reused by the re-imported
      // module when config is unchanged — do not kill them here.
      return;
    }
    try {
      ctx.ui.setStatus("mcp", undefined);
    } catch {
      // best effort
    }
    footerCtx = null;
    await manager.disconnectAll();
  });
}

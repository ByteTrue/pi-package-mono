// menu.ts — Clean, native Pi interactive menu for MCP management using
// standard Pi dialogs (select, confirm, input, editor, notify).
// Zero custom TUI frames, zero overlay diff bugs, zero terminal tearing.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ServerManager } from "./server-manager.js";
import type { McpConfig, ServerEntry, ToolMetadata } from "./types.js";
import {
  allPromptsText,
  allToolsText,
  writeProjectServerDisabledOverride,
  writeProjectServerDirectToolsOverride,
} from "./commands.js";
import { renderTsShape } from "./ts-shape.js";
import { rankToolMatches } from "./search-ranking.js";

const BACK = "← Back";
const EXIT = "✕ Exit";
const SEPARATOR = "────────────────────────────────────────";

export interface McpMenuContext {
  ui: NonNullable<ExtensionContext["ui"]>;
  cwd?: string;
}

/**
 * Main interactive entry point for `/mcp` in TUI mode.
 */
export async function runMcpMenu(
  manager: ServerManager,
  config: McpConfig,
  ctx: { ui?: ExtensionContext["ui"]; cwd?: string },
): Promise<void> {
  const ui = ctx.ui;
  if (!ui) return;
  const menuCtx: McpMenuContext = { ui, cwd: ctx.cwd ?? process.cwd() };

  while (true) {
    const statuses = manager.status();
    const enabled = statuses.filter((s) => !s.disabled);
    const connected = statuses.filter((s) => s.connected);
    const disabledCount = statuses.length - enabled.length;

    const serverOptions = statuses.map((s) => {
      const icon = s.disabled ? "⊘" : s.connected ? "✓" : s.failed ? "✗" : "○";
      const statusLabel = s.disabled
        ? "disabled"
        : s.connected
          ? "connected"
          : s.failed
            ? `failed (${s.failedAgeSeconds ?? 0}s ago)`
            : s.cached
              ? "cached (offline)"
              : "not connected";

      const entry = config.mcpServers[s.name];
      const directTools = entry?.directTools;
      const directInfo = Array.isArray(directTools)
        ? ` (${directTools.length} direct)`
        : directTools === true
          ? " (all direct)"
          : "";

      return `${icon} ${s.name} [${s.toolCount} tools${directInfo}] — ${statusLabel}`;
    });

    const totalTools = enabled.reduce((acc, s) => acc + s.toolCount, 0);
    const actionReconnectAll = `🔄 Reconnect all servers (${enabled.length} enabled)`;
    const actionViewTools = `📋 Browse all tools (${totalTools})`;
    const actionViewPrompts = "💬 Browse all prompts";
    const actionSearch = "🔍 Search tools...";

    const choices = [
      ...serverOptions,
      SEPARATOR,
      actionReconnectAll,
      actionViewTools,
      actionViewPrompts,
      actionSearch,
      EXIT,
    ];

    const title = `MCP Management (${enabled.length} enabled, ${connected.length} connected${
      disabledCount > 0 ? `, ${disabledCount} disabled` : ""
    })`;

    const pick = await ui.select(title, choices);
    if (!pick || pick === EXIT) return;

    if (pick === SEPARATOR) continue;

    if (pick === actionReconnectAll) {
      await reconnectAllServers(manager, menuCtx);
      continue;
    }

    if (pick === actionViewTools) {
      await ui.editor("All MCP Tools", allToolsText(manager, config.mcpServers));
      continue;
    }

    if (pick === actionViewPrompts) {
      await ui.editor("All MCP Prompts", allPromptsText(manager, config.mcpServers));
      continue;
    }

    if (pick === actionSearch) {
      await runSearchMenu(manager, config, menuCtx);
      continue;
    }

    // A specific server row was selected
    const idx = serverOptions.indexOf(pick);
    if (idx >= 0) {
      const serverStatus = statuses[idx];
      if (serverStatus) {
        await runServerMenu(serverStatus.name, manager, config, menuCtx);
      }
    }
  }
}

async function runServerMenu(
  serverName: string,
  manager: ServerManager,
  config: McpConfig,
  ctx: McpMenuContext,
): Promise<void> {
  const ui = ctx.ui;

  while (true) {
    const entry = config.mcpServers[serverName];
    if (!entry) return;

    const row = manager.status().find((s) => s.name === serverName);
    const isConn = row?.connected ?? false;
    const isDis = entry.disabled === true;
    const toolCount = row?.toolCount ?? 0;
    const directTools = entry.directTools;
    const directCount = Array.isArray(directTools)
      ? directTools.length
      : directTools === true
        ? toolCount
        : 0;

    const statusLabel = isDis
      ? "disabled"
      : isConn
        ? "connected"
        : row?.failed
          ? `failed (${row.lastError ?? "error"})`
          : row?.cached
            ? "cached (offline)"
            : "not connected";

    const actions: string[] = [];
    if (isDis) {
      actions.push("✓ Enable server");
    } else {
      actions.push(isConn ? "🔄 Reconnect" : "⚡ Connect");
      actions.push("⊘ Disable server");
      actions.push(`🛠️ Configure direct tools (${directCount} direct)`);
      if (toolCount > 0) {
        actions.push(`📋 Browse server tools (${toolCount})`);
      }
    }
    actions.push(BACK);

    const action = await ui.select(`${serverName} — ${statusLabel}`, actions);
    if (!action || action === BACK) return;

    if (action === "✓ Enable server" || action === "⊘ Disable server") {
      const targetDisabled = !isDis;
      try {
        const res = writeProjectServerDisabledOverride(ctx.cwd ?? process.cwd(), serverName, targetDisabled, config);
        entry.disabled = targetDisabled ? true : undefined;
        ui.notify(
          res.changed
            ? `${targetDisabled ? "Disabled" : "Enabled"} "${serverName}" in ${res.path} — run /reload to apply`
            : `"${serverName}" is already ${targetDisabled ? "disabled" : "enabled"}`,
          "info",
        );
      } catch (err) {
        ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
      continue;
    }

    if (action === "🔄 Reconnect" || action === "⚡ Connect") {
      ui.notify(`Connecting to ${serverName}...`, "info");
      try {
        const state = await manager.reconnect(serverName);
        ui.notify(`Connected ${serverName}: ${state.tools.length} tools.`, "info");
      } catch (err) {
        ui.notify(`Failed to connect ${serverName}: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
      continue;
    }

    if (action.startsWith("🛠️ Configure direct tools")) {
      await runDirectToolsMenu(serverName, manager, config, ctx);
      continue;
    }

    if (action.startsWith("📋 Browse server tools")) {
      await runBrowseToolsMenu(serverName, manager, ctx);
      continue;
    }
  }
}

async function runDirectToolsMenu(
  serverName: string,
  manager: ServerManager,
  config: McpConfig,
  ctx: McpMenuContext,
): Promise<void> {
  const ui = ctx.ui;
  const meta = manager.metadataFor(serverName);
  if (!meta || meta.tools.length === 0) {
    ui.notify(`No cached tools for "${serverName}". Connect the server first.`, "info");
    return;
  }

  const allTools = meta.tools;
  const entry = config.mcpServers[serverName];
  const initial = entry?.directTools;

  const selected = new Set<string>();
  if (initial === true) {
    for (const t of allTools) selected.add(t.originalName);
  } else if (Array.isArray(initial)) {
    for (const name of initial) selected.add(name);
  }

  const SAVE = "💾 Save to .pi/mcp.json";
  const SELECT_ALL = "🌟 Select all";
  const DESELECT_ALL = "⭕ Deselect all";
  const CANCEL = "← Cancel (discard changes)";

  while (true) {
    const toolItems = allTools.map((t) => {
      const isChecked = selected.has(t.originalName);
      const mark = isChecked ? "● [direct]" : "○ [on-demand]";
      const desc = t.description ? ` — ${t.description.split("\n")[0]}` : "";
      return `${mark} ${t.name}${desc}`;
    });

    const choices = [
      SAVE,
      selected.size === allTools.length ? DESELECT_ALL : SELECT_ALL,
      SEPARATOR,
      ...toolItems,
      CANCEL,
    ];

    const pick = await ui.select(
      `Direct tools: ${serverName} (${selected.size}/${allTools.length} selected)`,
      choices,
    );

    if (!pick || pick === CANCEL) return;

    if (pick === SAVE) {
      let finalVal: true | string[] | false;
      if (selected.size === allTools.length && allTools.length > 0) finalVal = true;
      else if (selected.size === 0) finalVal = false;
      else finalVal = Array.from(selected);

      try {
        const res = writeProjectServerDirectToolsOverride(ctx.cwd ?? process.cwd(), serverName, finalVal);
        if (entry) {
          entry.directTools = finalVal === false ? undefined : finalVal;
        }
        ui.notify(
          res.changed
            ? `Direct tools saved to ${res.path} — run /reload to apply`
            : "No changes to write.",
          "info",
        );
      } catch (err) {
        ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
      return;
    }

    if (pick === SELECT_ALL) {
      for (const t of allTools) selected.add(t.originalName);
      continue;
    }

    if (pick === DESELECT_ALL) {
      selected.clear();
      continue;
    }

    if (pick === SEPARATOR) continue;

    const idx = toolItems.indexOf(pick);
    if (idx >= 0) {
      const tool = allTools[idx];
      if (tool) {
        if (selected.has(tool.originalName)) {
          selected.delete(tool.originalName);
        } else {
          selected.add(tool.originalName);
        }
      }
    }
  }
}

async function runBrowseToolsMenu(
  serverName: string,
  manager: ServerManager,
  ctx: McpMenuContext,
): Promise<void> {
  const ui = ctx.ui;
  const meta = manager.metadataFor(serverName);
  if (!meta || meta.tools.length === 0) return;

  while (true) {
    const toolChoices = meta.tools.map((t) => {
      const desc = t.description ? ` — ${t.description.split("\n")[0]}` : "";
      return `${t.name}${desc}`;
    });

    const pick = await ui.select(`Tools: ${serverName} (${meta.tools.length})`, [...toolChoices, BACK]);
    if (!pick || pick === BACK) return;

    const idx = toolChoices.indexOf(pick);
    const tool = meta.tools[idx];
    if (tool) {
      const shape = renderTsShape(tool.inputSchema);
      const params = shape ? `Shape:\n${shape}` : `Parameters:\n${JSON.stringify(tool.inputSchema ?? {}, null, 2)}`;
      const details = `Tool: ${tool.name}\nServer: ${serverName}\n\n${tool.description || "(no description)"}\n\n${params}`;
      await ui.editor(`Tool — ${tool.name}`, details);
    }
  }
}

async function runSearchMenu(
  manager: ServerManager,
  config: McpConfig,
  ctx: McpMenuContext,
): Promise<void> {
  const ui = ctx.ui;
  const query = await ui.input("Search MCP Tools", "keyword or pattern...");
  if (!query || !query.trim()) return;

  const toolMetadata = new Map<string, ToolMetadata[]>();
  for (const name of Object.keys(config.mcpServers)) {
    if (config.mcpServers[name]?.disabled === true) continue;
    const meta = manager.metadataFor(name);
    if (meta) toolMetadata.set(name, meta.tools);
  }

  const matches = rankToolMatches(
    {
      toolMetadata,
      config: { mcpServers: config.mcpServers, settings: config.settings },
      failureTracker: new Map(),
      connectedServers: new Set(manager.status().filter((s) => s.connected).map((s) => s.name)),
    },
    query.trim(),
  );

  if (matches.length === 0) {
    ui.notify(`No tools matching "${query}"`, "info");
    return;
  }

  const lines = [
    `Found ${matches.length} tool${matches.length === 1 ? "" : "s"} matching "${query}":`,
    "",
    ...matches.map((m) => {
      const desc = m.tool.description ? ` — ${m.tool.description.split("\n")[0]}` : "";
      return `- ${m.tool.name} [${m.server}]${desc}`;
    }),
  ];

  await ui.editor(`Search: ${query}`, lines.join("\n"));
}

async function reconnectAllServers(
  manager: ServerManager,
  ctx: McpMenuContext,
): Promise<void> {
  const ui = ctx.ui;
  const targets = manager.status().filter((s) => !s.disabled);
  if (targets.length === 0) {
    ui.notify("No enabled servers to reconnect.", "info");
    return;
  }

  ui.notify(`Reconnecting ${targets.length} servers...`, "info");
  const results = await Promise.allSettled(targets.map((s) => manager.reconnect(s.name)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    ui.notify(`Reconnected ${targets.length - failed} ok, ${failed} failed.`, "warning");
  } else {
    ui.notify(`Reconnected all ${targets.length} servers.`, "info");
  }
}

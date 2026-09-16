// commands.ts — /mcp subcommand surface, following pi-mcp-adapter's
// commands.ts (MIT): status text, tools/prompts listings, and the
// enable/disable project-override writer. Pure string/IO helpers; the
// extension entry wires them to ctx.ui.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerManager } from "./server-manager.js";
import { stripJsonComments } from "./config.js";
import type { McpConfig, ServerEntry } from "./types.js";
/** One-line summary per server with upstream's five states. */
export function serverStatusLines(manager: ServerManager): string[] {
  return manager.status().map((s) => {
    if (s.disabled) return `⊘ ${s.name}: disabled (enable with /mcp enable ${s.name}, then /reload)`;
    if (s.connected) return `✓ ${s.name}: connected (${s.toolCount} tools)`;
    if (s.failed) {
      const reason = s.lastError ? ` — ${s.lastError}` : "";
      return `✗ ${s.name}: failed ${s.failedAgeSeconds ?? 0}s ago${reason}`;
    }
    if (s.cached) return `○ ${s.name}: cached; not connected (${s.toolCount} tools)`;
    return `○ ${s.name}: not connected`;
  });
}

/** All tools across enabled servers (cache-backed, no connections spawned). */
export function allToolsText(manager: ServerManager, config: Record<string, ServerEntry>): string {
  const lines: string[] = [];
  let total = 0;
  for (const [serverName, entry] of Object.entries(config)) {
    if (entry.disabled === true) continue;
    const meta = manager.metadataFor(serverName);
    if (!meta || meta.tools.length === 0) continue;
    lines.push(`${serverName}:`);
    for (const tool of meta.tools) {
      lines.push(`  ${tool.name}${tool.description ? ` — ${tool.description.split("\n")[0] ?? ""}` : ""}`);
      total++;
    }
  }
  if (total === 0) return "No MCP tools available. Connect a server first: mcp({ connect: \"name\" }) or /mcp reconnect.";
  return [`MCP tools (${total}):`, "", ...lines].join("\n");
}

/** All prompts across enabled servers, grouped by server (upstream format). */
export function allPromptsText(manager: ServerManager, config: Record<string, ServerEntry>): string {
  const grouped = new Map<string, Array<{ commandName: string; description: string; arguments: Array<{ name: string; required?: boolean }> }>>();
  let total = 0;
  for (const [serverName, entry] of Object.entries(config)) {
    if (entry.disabled === true) continue;
    const meta = manager.metadataFor(serverName);
    if (!meta || meta.prompts.length === 0) continue;
    grouped.set(serverName, meta.prompts.map((p) => ({ commandName: p.commandName, description: p.description, arguments: p.arguments })));
    total += meta.prompts.length;
  }
  if (total === 0) {
    return "No MCP prompts available. Prompts are discovered when servers with the `prompts` capability connect.";
  }
  const lines = ["MCP prompts:", ""];
  for (const [serverName, prompts] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${serverName}:`);
    for (const prompt of prompts.sort((a, b) => a.commandName.localeCompare(b.commandName))) {
      const args = prompt.arguments.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" ");
      lines.push(`  /${prompt.commandName}${args ? ` ${args}` : ""}`);
      if (prompt.description) lines.push(`      ${prompt.description}`);
    }
    lines.push("");
  }
  lines.push(`Total: ${total} prompt${total === 1 ? "" : "s"}`);
  return lines.join("\n");
}

/** Footer status line per mcpFooterStatus setting; undefined clears the slot. */
export function footerStatusText(
  manager: ServerManager,
  mode: "full" | "compact" | "off" | undefined,
): string | undefined {
  if (mode === "off") return undefined;
  const rows = manager.status();
  if (rows.length === 0) return undefined;
  const enabledCount = rows.filter((s) => !s.disabled).length;
  const disabledCount = rows.length - enabledCount;
  const connectedCount = rows.filter((s) => s.connected).length;
  if (mode === "compact") return `mcp:${connectedCount}/${enabledCount}`;
  let status = `${enabledCount} ${enabledCount === 1 ? "server" : "servers"} enabled`;
  if (connectedCount > 0) status += ` (${connectedCount} connected)`;
  if (disabledCount > 0) status += ` (${disabledCount} disabled)`;
  return status;
}

export interface DisabledOverrideResult {
  path: string;
  changed: boolean;
}

function parseJsonFile(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(stripJsonComments(readFileSync(filePath, "utf-8")));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("root value must be an object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Toggle `disabled` on a server via the highest-precedence project override
 * (`.pi/mcp.json`), upstream's writeProjectServerDisabledOverride semantics:
 * disabling writes a `{disabled: true}` marker; enabling removes the marker,
 * and only writes `disabled: false` when a lower layer still disables it.
 */
export function writeProjectServerDisabledOverride(
  cwd: string,
  serverName: string,
  disabled: boolean,
  config: McpConfig,
): DisabledOverrideResult {
  const filePath = resolve(cwd, ".pi", "mcp.json");
  let raw: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      raw = parseJsonFile(filePath);
    } catch (error) {
      throw new Error(`Failed to read project MCP override at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const serverKey = raw.mcpServers !== undefined ? "mcpServers" : raw["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
  const rawServers = raw[serverKey];
  if (rawServers !== undefined && (typeof rawServers !== "object" || rawServers === null || Array.isArray(rawServers))) {
    throw new Error(`Failed to update project MCP override at ${filePath}: ${serverKey} must be an object`);
  }
  const servers = (rawServers ?? {}) as Record<string, unknown>;
  const previous = servers[serverName];
  if (previous !== undefined && (typeof previous !== "object" || previous === null || Array.isArray(previous))) {
    throw new Error(`Failed to update project MCP override at ${filePath}: server "${serverName}" must be an object`);
  }
  const existing = previous as Record<string, unknown> | undefined;

  let next: Record<string, unknown>;
  if (disabled) {
    next = { ...existing, disabled: true };
  } else {
    next = Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => key !== "disabled"));
    // When a lower layer still disables the server, keep an explicit
    // `disabled: false` so the enable survives the merge.
    if (config.mcpServers[serverName]?.disabled === true) next.disabled = false;
  }

  if ((!existing && Object.keys(next).length === 0) || JSON.stringify(existing) === JSON.stringify(next)) {
    return { path: filePath, changed: false };
  }
  if (Object.keys(next).length === 0) delete servers[serverName];
  else servers[serverName] = next;

  raw[serverKey] = servers;
  writeRawConfigObject(filePath, raw);
  return { path: filePath, changed: true };
}

function writeRawConfigObject(filePath: string, raw: Record<string, unknown>): void {
  const data = `${JSON.stringify(raw, null, 2)}\n`;
  if (existsSync(filePath)) {
    // writeFileSync ("w") truncates and preserves the file's existing mode.
    writeFileSync(filePath, data);
  } else {
    // New project override: 0600 since mcp.json may carry credential material.
    mkdirSync(resolve(filePath, ".."), { recursive: true });
    writeFileSync(filePath, data, { mode: 0o600 });
  }
}

/**
 * Apply a panel directTools selection via the project override: `true`/list
 * writes the field; `false` removes it so the lower-layer value applies again.
 */
export function writeProjectServerDirectToolsOverride(
  cwd: string,
  serverName: string,
  selection: true | string[] | false,
): DisabledOverrideResult {
  const filePath = resolve(cwd, ".pi", "mcp.json");
  let raw: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      raw = parseJsonFile(filePath);
    } catch (error) {
      throw new Error(`Failed to read project MCP override at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const serverKey = raw.mcpServers !== undefined ? "mcpServers" : raw["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
  const rawServers = raw[serverKey];
  if (rawServers !== undefined && (typeof rawServers !== "object" || rawServers === null || Array.isArray(rawServers))) {
    throw new Error(`Failed to update project MCP override at ${filePath}: ${serverKey} must be an object`);
  }
  const servers = (rawServers ?? {}) as Record<string, unknown>;
  const previous = servers[serverName];
  if (previous !== undefined && (typeof previous !== "object" || previous === null || Array.isArray(previous))) {
    throw new Error(`Failed to update project MCP override at ${filePath}: server "${serverName}" must be an object`);
  }
  const existing = previous as Record<string, unknown> | undefined;

  let next: Record<string, unknown>;
  if (selection === false) {
    next = Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => key !== "directTools"));
  } else {
    next = { ...existing, directTools: selection };
  }

  if ((!existing && Object.keys(next).length === 0) || JSON.stringify(existing) === JSON.stringify(next)) {
    return { path: filePath, changed: false };
  }
  if (Object.keys(next).length === 0) delete servers[serverName];
  else servers[serverName] = next;

  raw[serverKey] = servers;
  writeRawConfigObject(filePath, raw);
  return { path: filePath, changed: true };
}

/** /mcp subcommand list for argument completion (server names for the rest). */export const MCP_SUBCOMMANDS: Array<{ value: string; label: string }> = [
  { value: "status", label: "status — Show server status" },
  { value: "reconnect", label: "reconnect — Reconnect servers" },
  { value: "tools", label: "tools — List all tools" },
  { value: "prompts", label: "prompts — List all MCP prompts" },
  { value: "enable", label: "enable — Enable a server" },
  { value: "disable", label: "disable — Disable a server" },
];

/** Tab-completion candidates for /mcp arguments (upstream behavior). */
export function mcpArgumentCompletions(
  prefix: string,
  config: Record<string, ServerEntry>,
): Array<{ value: string; label: string }> | null {
  const normalized = prefix.trimStart();
  const argumentMatch = normalized.match(/^(\S+)\s+(.*)$/);
  if (!argumentMatch) {
    const subcommands = MCP_SUBCOMMANDS.filter(({ value }) => value.startsWith(normalized));
    return subcommands.length > 0 ? subcommands : null;
  }
  const [, subcommand, argumentPrefix] = argumentMatch;
  if ((subcommand !== "reconnect" && subcommand !== "enable" && subcommand !== "disable") || argumentPrefix === undefined) {
    return null;
  }
  return Object.keys(config)
    .filter((serverName) => serverName.startsWith(argumentPrefix.trimStart()))
    .map((serverName) => ({ value: `${subcommand} ${serverName}`, label: serverName }));
}

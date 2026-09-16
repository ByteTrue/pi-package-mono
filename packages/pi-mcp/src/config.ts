// config.ts — layered MCP config loading with the same layout as pi-mcp-adapter / Claude Code / Cursor.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpConfig, McpSettings, McpTraceSettings, ServerEntry } from "./types.js";

function genericGlobalConfigPath(): string {
  return join(homedir(), ".config", "mcp", "mcp.json");
}

function agentsGlobalConfigPaths(): string[] {
  return [join(homedir(), ".agents", "mcp.json"), join(homedir(), ".agents", "mcp", "mcp.json")];
}

function getAgentDir(): string {
  // Same self-contained resolution pi-mcp-adapter uses (agent-dir.ts):
  // honor PI_CODING_AGENT_DIR without importing pi core.
  const appName = "pi";
  const configured = process.env[`${appName.toUpperCase()}_CODING_AGENT_DIR`]?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
  return resolve(configured);
}

export function getPiGlobalConfigPath(): string {
  return join(getAgentDir(), "mcp.json");
}

export interface ConfigSource {
  id: "shared-global" | "agents-global" | "agents-nested-global" | "pi-global" | "shared-project" | "pi-project";
  path: string;
  exists: boolean;
}

export function getConfigSources(cwd = process.cwd()): ConfigSource[] {
  const userPath = getPiGlobalConfigPath();
  const projectPath = resolve(cwd, ".mcp.json");
  const projectPiPath = resolve(cwd, ".pi", "mcp.json");
  const sources: ConfigSource[] = [];

  // Precedence low → high: shared-global, .agents, pi-global, project, pi-project.
  // Same order as pi-mcp-adapter's getConfigSources(). Paths resolve lazily
  // so HOME/PI_CODING_AGENT_DIR changes after module load are honored.
  const genericGlobal = genericGlobalConfigPath();
  if (genericGlobal !== userPath) {
    sources.push({ id: "shared-global", path: genericGlobal, exists: existsSync(genericGlobal) });
  }
  for (const [index, agentsPath] of agentsGlobalConfigPaths().entries()) {
    if (agentsPath === userPath || agentsPath === genericGlobal) continue;
    sources.push({
      id: index === 0 ? "agents-global" : "agents-nested-global",
      path: agentsPath,
      exists: existsSync(agentsPath),
    });
  }
  sources.push({ id: "pi-global", path: userPath, exists: existsSync(userPath) });
  if (projectPath !== userPath) {
    sources.push({ id: "shared-project", path: projectPath, exists: existsSync(projectPath) });
  }
  if (projectPiPath !== userPath && projectPiPath !== projectPath) {
    sources.push({ id: "pi-project", path: projectPiPath, exists: existsSync(projectPiPath) });
  }
  return sources;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeServerEntry(name: string, raw: unknown): ServerEntry | null {
  if (!isRecord(raw)) return null;
  const entry: ServerEntry = {};
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
  const strArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === "string") && v.length > 0 ? (v as string[]) : undefined;

  const command = str(raw.command);
  const url = str(raw.url);
  if (!command && !url) {
    // A bare `{"disabled": true|false}` override is legal: it toggles an
    // inherited same-name server without restating its transport.
    if (raw.disabled === true) return { disabled: true };
    if (raw.disabled === false) return { disabled: false };
    console.warn(`[pi-mcp] server "${name}" has neither command nor url; skipped`);
    return null;
  }
  if (command) entry.command = command;
  if (url) entry.url = url;
  if (raw.args !== undefined) {
    const args = strArray(raw.args);
    if (args === undefined && raw.args !== null) {
      console.warn(`[pi-mcp] server "${name}" has invalid args; skipped`);
      return null;
    }
    if (args) entry.args = args;
  }
  if (isRecord(raw.env)) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.env)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") env[k] = String(v);
    }
    entry.env = env;
  }
  if (raw.inheritEnv === false) entry.inheritEnv = false;
  const cwd = str(raw.cwd);
  if (cwd) entry.cwd = cwd;
  const toolPrefix = str(raw.toolPrefix);
  if (toolPrefix === "server" || toolPrefix === "none" || toolPrefix === "short" || toolPrefix === "mcp") {
    entry.toolPrefix = toolPrefix;
  }
  if (isRecord(raw.headers)) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.headers)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") headers[k] = String(v);
    }
    entry.headers = headers;
  }
  if (raw.type === "stdio" || raw.type === "http") entry.type = raw.type;
  if (raw.disabled === true) entry.disabled = true;
  if (raw.lifecycle === "eager") entry.lifecycle = "eager";
  if (typeof raw.idleTimeout === "number" && Number.isFinite(raw.idleTimeout) && raw.idleTimeout >= 0) {
    entry.idleTimeout = raw.idleTimeout;
  }
  if (raw.directTools === true) entry.directTools = true;
  else if (Array.isArray(raw.directTools) && raw.directTools.every((t) => typeof t === "string")) {
    entry.directTools = raw.directTools as string[];
  }
  const includeTools = strArray(raw.includeTools);
  if (includeTools) entry.includeTools = includeTools;
  const excludeTools = strArray(raw.excludeTools);
  if (excludeTools) entry.excludeTools = excludeTools;
  if (isRecord(raw.searchKeywords)) {
    const keywords: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw.searchKeywords)) {
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) keywords[k] = v as string[];
    }
    if (Object.keys(keywords).length > 0) entry.searchKeywords = keywords;
  }
  if (raw.trace === true) entry.trace = true;
  return entry;
}

function readValidatedConfig(path: string): McpConfig | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf-8")));
  } catch (error) {
    console.warn(`[pi-mcp] failed to parse ${path}:`, error instanceof Error ? error.message : error);
    return null;
  }
  if (!isRecord(parsed)) return { mcpServers: {} };
  const rawServers = parsed.mcpServers ?? parsed["mcp-servers"];
  const mcpServers: Record<string, ServerEntry> = {};
  if (isRecord(rawServers)) {
    for (const [name, raw] of Object.entries(rawServers)) {
      const entry = normalizeServerEntry(name, raw);
      if (entry) mcpServers[name] = entry;
    }
  }
  const config: McpConfig = { mcpServers };
  if (isRecord(parsed.settings)) {
    const s = parsed.settings;
    const settings: NonNullable<McpConfig["settings"]> = {};
    if (typeof s.idleTimeout === "number" && s.idleTimeout >= 0) settings.idleTimeout = s.idleTimeout;
    if (s.outputGuard !== undefined) settings.outputGuard = s.outputGuard as never;
    if (s.toolPrefix === "server" || s.toolPrefix === "none" || s.toolPrefix === "short" || s.toolPrefix === "mcp") {
      settings.toolPrefix = s.toolPrefix;
    }
    if (s.directTools === true) settings.directTools = true;
    if (s.mcpFooterStatus === "full" || s.mcpFooterStatus === "compact" || s.mcpFooterStatus === "off") {
      settings.mcpFooterStatus = s.mcpFooterStatus;
    }
    if (isRecord(s.trace)) {
      const trace: NonNullable<McpSettings["trace"]> = {};
      if (s.trace.enabled === true) trace.enabled = true;
      if (typeof s.trace.file === "string" && s.trace.file.trim()) trace.file = s.trace.file.trim();
      if (typeof s.trace.maxBytes === "number" && s.trace.maxBytes > 0) trace.maxBytes = s.trace.maxBytes;
      if (typeof s.trace.maxEvents === "number" && s.trace.maxEvents > 0) trace.maxEvents = s.trace.maxEvents;
      if (Object.keys(trace).length > 0) settings.trace = trace;
    }
    if (Object.keys(settings).length > 0) config.settings = settings;
  }
  return config;
}

export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++; // consume trailing '/'
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Merge with later sources overriding same-name servers, per field
 * (upstream mergeServerMaps semantics): a higher layer may ship a bare
 * `{"disabled": true}` marker to disable an inherited server, or
 * `{"disabled": false}` to re-enable one. When a higher layer repoints a
 * stdio server at a command or an HTTP server at a new url, credential
 * material bound to the previous target (headers) is NOT inherited. */
export function mergeConfigs(base: McpConfig, overlay: McpConfig): McpConfig {
  const mcpServers: Record<string, ServerEntry> = { ...base.mcpServers };
  for (const [name, next] of Object.entries(overlay.mcpServers)) {
    const prev = mcpServers[name];
    if (prev) {
      const merged: ServerEntry = { ...prev, ...next };
      // url-bound credential guard: a new target must not inherit old headers.
      if (next.command !== undefined && prev.url !== undefined) {
        delete merged.url;
        delete merged.headers;
      } else if (next.url !== undefined && next.url !== prev.url) {
        delete merged.headers;
      }
      mcpServers[name] = merged;
    } else {
      mcpServers[name] = next;
    }
  }
  return { mcpServers, settings: { ...base.settings, ...overlay.settings } };
}

export function loadMcpConfig(cwd = process.cwd()): McpConfig {
  let config: McpConfig = { mcpServers: {} };
  for (const source of getConfigSources(cwd)) {
    const loaded = readValidatedConfig(source.path);
    if (!loaded) continue;
    config = mergeConfigs(config, loaded);
  }
  // Disabled servers stay visible in the merged config (marked disabled) so
  // /mcp can show ⊘ disabled and re-enable them; connect paths skip them.
  return config;
}

export { readValidatedConfig };

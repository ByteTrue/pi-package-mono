// metadata-cache.ts — persistent MCP metadata cache, ported from
// pi-mcp-adapter's metadata-cache.ts (MIT) with the UI-resource surface
// removed. Same on-disk format (version 1, mcp-cache.json) so an existing
// upstream cache carries over on migration.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getAgentPath } from "./agent-dir.js";
import { createHash } from "node:crypto";
import type {
  McpConfig,
  MetadataCache,
  ServerCacheEntry,
  ServerEntry,
  ToolMetadata,
  PromptMetadata,
  CachedTool,
  CachedPrompt,
} from "./types.js";
import {
  formatPromptCommandName,
  formatToolName,
  getToolNameCandidates,
  isServerDisabled,
  matchesToolPattern,
  resolveToolPrefix,
  type ToolPrefix,
} from "./tool-naming.js";

const CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type { CachedPrompt, CachedTool, MetadataCache, ServerCacheEntry } from "./types.js";

export function getMetadataCachePath(): string {
  return getAgentPath("mcp-cache.json");
}

export function loadMetadataCache(): MetadataCache | null {
  const cachePath = getMetadataCachePath();
  if (!existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    if (raw.version !== CACHE_VERSION) return null;
    if (!raw.servers || typeof raw.servers !== "object") return null;
    return raw as MetadataCache;
  } catch {
    return null;
  }
}

export function saveMetadataCache(cache: MetadataCache): void {
  const cachePath = getMetadataCachePath();
  const dir = dirname(cachePath);
  mkdirSync(dir, { recursive: true });

  let merged: MetadataCache = { version: CACHE_VERSION, servers: {} };
  try {
    if (existsSync(cachePath)) {
      const existing = JSON.parse(readFileSync(cachePath, "utf-8")) as MetadataCache;
      if (existing && existing.version === CACHE_VERSION && existing.servers) {
        merged.servers = { ...existing.servers };
      }
    }
  } catch {
    // Ignore parse errors and proceed with empty cache
  }

  merged.version = CACHE_VERSION;
  merged.servers = { ...merged.servers, ...cache.servers };

  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(merged), "utf-8");
  renameSync(tmpPath, cachePath);
}

function stableStringify(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, val]) => [k, normalize(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

export function computeServerHash(definition: ServerEntry): string {
  // Hash only fields that affect server identity and tool output.
  // Lifecycle/idleTimeout are runtime behavior settings that don't change
  // which tools a server exposes (upstream parity).
  const identity: Record<string, unknown> = {
    command: definition.command,
    args: definition.args,
    env: definition.env,
    cwd: definition.cwd,
    url: definition.url,
    headers: definition.headers,
    includeTools: definition.includeTools,
    excludeTools: definition.excludeTools,
  };
  return createHash("sha256").update(stableStringify(identity)).digest("hex");
}

export function isServerCacheValid(
  entry: ServerCacheEntry,
  definition: ServerEntry,
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): boolean {
  let configHash: string;
  try {
    configHash = computeServerHash(definition);
  } catch {
    return false;
  }
  if (!entry || entry.configHash !== configHash) return false;
  if (!entry.cachedAt || typeof entry.cachedAt !== "number") return false;
  if (maxAgeMs > 0 && Date.now() - entry.cachedAt > maxAgeMs) return false;
  return true;
}

function toolAllowed(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix,
  definition: Pick<ServerEntry, "includeTools" | "excludeTools">,
): boolean {
  // Upstream isToolAllowed semantics: exact candidate hit or glob over candidates.
  const candidates = getToolNameCandidates(toolName, serverName, prefix, false);
  const include = definition.includeTools;
  if (Array.isArray(include) && include.length > 0) {
    if (!matchesToolPattern(candidates, include)) return false;
  }
  const exclude = definition.excludeTools;
  if (Array.isArray(exclude) && exclude.length > 0) {
    if (matchesToolPattern(candidates, exclude)) return false;
  }
  return true;
}

export function reconstructToolMetadata(
  serverName: string,
  entry: ServerCacheEntry,
  prefix: ToolPrefix,
  definition: Pick<ServerEntry, "includeTools" | "excludeTools" | "toolPrefix">,
): ToolMetadata[] {
  const metadata: ToolMetadata[] = [];
  const seenNames = new Set<string>();
  const effectivePrefix = resolveToolPrefix(definition, prefix);

  for (const tool of entry.tools ?? []) {
    if (!tool?.name) continue;
    if (!toolAllowed(tool.name, serverName, effectivePrefix, definition)) continue;

    const name = formatToolName(tool.name, serverName, effectivePrefix);
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    metadata.push({
      name,
      originalName: tool.name,
      description: tool.description ?? "",
      ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
    });
  }
  return metadata;
}

export function reconstructPromptMetadata(
  serverName: string,
  prompts: ReadonlyArray<CachedPrompt>,
  prefix: ToolPrefix,
  definition?: Pick<ServerEntry, "toolPrefix">,
): PromptMetadata[] {
  const effectivePrefix = resolveToolPrefix(definition, prefix);
  const specs: PromptMetadata[] = [];
  for (const prompt of prompts ?? []) {
    if (!prompt?.name) continue;
    const args = Array.isArray(prompt.arguments)
      ? prompt.arguments.map((a) => ({
          name: a.name,
          ...(a.description !== undefined ? { description: a.description } : {}),
          ...(a.required !== undefined ? { required: a.required } : {}),
        }))
      : [];
    specs.push({
      serverName,
      originalName: prompt.name,
      commandName: formatPromptCommandName(prompt.name, serverName, effectivePrefix),
      ...(prompt.title !== undefined ? { title: prompt.title } : {}),
      description: prompt.description ?? "",
      arguments: args,
    });
  }
  return specs;
}

/** Cached tools/prompts for configured+valid servers, reconstructed for search and direct tools. */
export function getCachedMetadataForConfig(
  config: McpConfig,
  cache: MetadataCache | null,
): Map<string, { tools: ToolMetadata[]; prompts: PromptMetadata[]; instructions?: string }> {
  const out = new Map<string, { tools: ToolMetadata[]; prompts: PromptMetadata[]; instructions?: string }>();
  if (!cache?.servers) return out;
  const prefix = config.settings?.toolPrefix ?? "server";
  for (const [serverName, definition] of Object.entries(config.mcpServers)) {
    if (isServerDisabled(definition)) continue;
    const entry = cache.servers[serverName];
    if (!entry || !isServerCacheValid(entry, definition)) continue;
    out.set(serverName, {
      tools: reconstructToolMetadata(serverName, entry, prefix, definition),
      prompts: reconstructPromptMetadata(serverName, entry.prompts ?? [], prefix, definition),
      instructions: entry.instructions,
    });
  }
  return out;
}

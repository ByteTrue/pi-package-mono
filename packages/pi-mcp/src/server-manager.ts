// server-manager.ts — connection lifecycle for MCP servers, following
// pi-mcp-adapter's server-manager.ts (MIT): lazy connect with concurrent
// caller coalescing, idle disconnect, automatic reconnect, full tools/prompts
// pagination, HTTP Streamable→SSE fallback on 404/405/406/415, and metadata
// persistence to the disk cache. OAuth/CA/trace surfaces are cut.
//
// Live connections are pinned on globalThis so a Pi /reload (which re-imports
// the extension via jiti and would otherwise replace module singletons) does
// not orphan running server processes.
import { Client, StreamableHTTPClientTransport, SSEClientTransport, SdkHttpError } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ServerEntry, ToolMetadata, PromptMetadata, ServerCacheEntry } from "./types.js";
import { resolveNpxBinary } from "./npx-resolver.js";
import { computeServerHash, saveMetadataCache, loadMetadataCache } from "./metadata-cache.js";
import { formatToolName, resolveToolPrefix, formatPromptCommandName, type ToolPrefix } from "./tool-naming.js";
import { throwIfAborted } from "./abort.js";

const GLOBAL_STATE_KEY = Symbol.for("pi-mcp.server-manager");

export interface ConnectionState {
  client: Client;
  connectedAt: number;
  /** Metadata captured at connect time (also persisted to cache). */
  tools: ToolMetadata[];
  prompts: PromptMetadata[];
  instructions?: string;
}

export interface ManagedServer {
  name: string;
  entry: ServerEntry;
  state: ConnectionState | null;
  connecting: Promise<ConnectionState> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastError?: string;
  /** Failure timestamp for search backoff. */
  failedAt?: number;
}

function shouldFallbackToSse(error: unknown): boolean {
  return error instanceof SdkHttpError && [404, 405, 406, 415].includes(error.status);
}

export class ServerManager {
  readonly servers = new Map<string, ManagedServer>();
  private defaultIdleTimeoutSec: number;
  private globalPrefix: ToolPrefix;

  constructor(options: {
    config: Record<string, ServerEntry>;
    defaultIdleTimeoutSec?: number;
    globalPrefix?: ToolPrefix;
  }) {
    this.defaultIdleTimeoutSec = options.defaultIdleTimeoutSec ?? 600;
    this.globalPrefix = options.globalPrefix ?? "server";
    for (const [name, entry] of Object.entries(options.config)) {
      this.servers.set(name, { name, entry, state: null, connecting: null, idleTimer: null });
    }
  }

  /** Reconstructed metadata (live state first, then valid disk cache). */
  metadataFor(name: string): { tools: ToolMetadata[]; prompts: PromptMetadata[]; instructions?: string } | null {
    const server = this.servers.get(name);
    if (!server) return null;
    if (server.state) {
      return { tools: server.state.tools, prompts: server.state.prompts, instructions: server.state.instructions };
    }
    const cache = loadMetadataCache();
    const entry = cache?.servers[name];
    if (!entry || entry.configHash !== computeServerHash(server.entry)) return null;
    const prefix = resolveToolPrefix(server.entry, this.globalPrefix);
    return {
      tools: (entry.tools ?? []).map((t) => ({
        name: formatToolName(t.name, name, prefix),
        originalName: t.name,
        description: t.description ?? "",
        ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
      })),
      prompts: (entry.prompts ?? []).map((p) => ({
        serverName: name,
        originalName: p.name,
        commandName: formatPromptCommandName(p.name, name, prefix),
        description: p.description ?? "",
        arguments: p.arguments ?? [],
      })),
      instructions: entry.instructions,
    };
  }

  isConnected(name: string): boolean {
    return this.servers.get(name)?.state != null;
  }

  /** Get or create a connection. Concurrent callers share one connect. */
  async connect(name: string, signal?: AbortSignal): Promise<ConnectionState> {
    const server = this.servers.get(name);
    if (!server) throw new Error(`Unknown MCP server: ${name}`);
    if (server.state) return server.state;
    if (server.connecting) return server.connecting;
    throwIfAborted(signal);

    server.connecting = this.doConnect(server, signal).then(
      (state) => {
        server.state = state;
        server.lastError = undefined;
        server.failedAt = undefined;
        this.armIdleTimer(server);
        return state;
      },
      (error) => {
        server.lastError = error instanceof Error ? error.message : String(error);
        server.failedAt = Date.now();
        server.connecting = null;
        throw error;
      },
    );
    const result = await server.connecting;
    server.connecting = null;
    return result;
  }

  private async doConnect(server: ManagedServer, signal?: AbortSignal): Promise<ConnectionState> {
    const entry = server.entry;
    let client: Client;

    if (entry.url) {
      const url = new URL(entry.url);
      const requestInit = { headers: { ...(entry.headers ?? {}) } };
      const transportOptions = { requestInit };

      // Upstream parity: Streamable HTTP first; fall back to SSE only on
      // definitive endpoint incompatibility (404/405/406/415).
      let kind: "streamable-http" | "sse" = entry.type === "http" ? "streamable-http" : "streamable-http";
      for (;;) {
        const transport =
          kind === "streamable-http"
            ? new StreamableHTTPClientTransport(url, transportOptions)
            : new SSEClientTransport(url, transportOptions);
        const attempt = new Client({ name: "pi-mcp", version: "0.1.0" });
        try {
          await attempt.connect(transport);
          client = attempt;
          break;
        } catch (error) {
          try {
            await attempt.close();
          } catch {
            // best-effort cleanup
          }
          if (kind === "streamable-http" && shouldFallbackToSse(error)) {
            kind = "sse";
            continue;
          }
          throw error;
        }
      }
    } else {
      let command = entry.command!;
      let args = [...(entry.args ?? [])];
      if (command === "npx" || command === "npm") {
        const resolved = await resolveNpxBinary(command, args, signal);
        if (resolved) {
          command = resolved.isJs ? "node" : resolved.binPath;
          args = resolved.isJs ? [resolved.binPath, ...resolved.extraArgs] : resolved.extraArgs;
        }
      }
      throwIfAborted(signal);
      const inherited: Record<string, string> = {};
      if (entry.inheritEnv !== false) {
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined) inherited[k] = v;
        }
      }
      const env: Record<string, string> = { ...inherited, ...(entry.env ?? {}) };
      const transport = new StdioClientTransport({
        command,
        args,
        env: env as Record<string, string>,
        ...(entry.cwd ? { cwd: entry.cwd } : {}),
      });
      client = new Client({ name: "pi-mcp", version: "0.1.0" });
      await client.connect(transport);
    }

    const tools = await this.fetchAllTools(client, server.name);
    const prompts = await this.fetchAllPrompts(client, server.name);
    const instructions = client.getInstructions() || undefined;

    // Persist raw (unprefixed) metadata; reconstruction applies prefixes.
    const cacheEntry: ServerCacheEntry = {
      configHash: computeServerHash(entry),
      tools: tools.map((t) => ({
        name: t.originalName,
        description: t.description,
        ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
      })),
      prompts: prompts.map((p) => ({
        name: p.originalName,
        description: p.description,
        arguments: p.arguments,
      })),
      ...(instructions !== undefined ? { instructions } : {}),
      cachedAt: Date.now(),
    };
    const cache = loadMetadataCache() ?? { version: 1, servers: {} };
    cache.servers[server.name] = cacheEntry;
    saveMetadataCache(cache);

    return { client, connectedAt: Date.now(), tools, prompts, instructions };
  }

  private async fetchAllTools(client: Client, serverName: string): Promise<ToolMetadata[]> {
    const prefix = resolveToolPrefix(this.servers.get(serverName)?.entry, this.globalPrefix);
    const out: ToolMetadata[] = [];
    let cursor: string | undefined;
    do {
      const res = await client.listTools(cursor ? { cursor } : undefined);
      for (const tool of res.tools ?? []) {
        out.push({
          name: formatToolName(tool.name, serverName, prefix),
          originalName: tool.name,
          description: tool.description ?? "",
          ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
        });
      }
      cursor = res.nextCursor;
    } while (cursor);
    return out;
  }

  private async fetchAllPrompts(client: Client, serverName: string): Promise<PromptMetadata[]> {
    const capabilities = client.getServerCapabilities?.();
    if (!capabilities?.prompts) return [];
    const prefix = resolveToolPrefix(this.servers.get(serverName)?.entry, this.globalPrefix);
    const out: PromptMetadata[] = [];
    let cursor: string | undefined;
    do {
      const res = await client.listPrompts(cursor ? { cursor } : undefined);
      for (const prompt of res.prompts ?? []) {
        out.push({
          serverName,
          originalName: prompt.name,
          commandName: formatPromptCommandName(prompt.name, serverName, prefix),
          description: prompt.description ?? "",
          arguments: (prompt.arguments ?? []).map((a) => ({
            name: a.name,
            ...(a.description !== undefined ? { description: a.description } : {}),
            ...(a.required !== undefined ? { required: a.required } : {}),
          })),
        });
      }
      cursor = res.nextCursor;
    } while (cursor);
    return out;
  }

  /** Raw client for calls; connects lazily if needed. */
  async clientFor(name: string, signal?: AbortSignal): Promise<Client> {
    const state = await this.connect(name, signal);
    return state.client;
  }

  private armIdleTimer(server: ManagedServer) {
    this.disarmIdleTimer(server);
    const seconds = server.entry.idleTimeout ?? this.defaultIdleTimeoutSec;
    if (!seconds || seconds <= 0) return;
    server.idleTimer = setTimeout(() => {
      void this.disconnect(server.name).catch(() => {});
    }, seconds * 1000);
    server.idleTimer.unref?.();
  }

  private disarmIdleTimer(server: ManagedServer) {
    if (server.idleTimer) {
      clearTimeout(server.idleTimer);
      server.idleTimer = null;
    }
  }

  /** Drop a connection (idle timeout, explicit reconnect, or shutdown). */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;
    this.disarmIdleTimer(server);
    const state = server.state;
    server.state = null;
    server.connecting = null;
    if (state) {
      try {
        await state.client.close();
      } catch {
        // best effort
      }
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled([...this.servers.keys()].map((name) => this.disconnect(name)));
  }

  /** Force reconnect: drop and connect again. */
  async reconnect(name: string, signal?: AbortSignal): Promise<ConnectionState> {
    await this.disconnect(name);
    return this.connect(name, signal);
  }

  status(): Array<{ name: string; connected: boolean; toolCount: number; lastError?: string }> {
    return [...this.servers.values()].map((s) => ({
      name: s.name,
      connected: s.state != null,
      toolCount: s.state?.tools.length ?? this.metadataFor(s.name)?.tools.length ?? 0,
      lastError: s.lastError,
    }));
  }
}

/**
 * Get or create the process-global ServerManager. Pi's /reload re-imports the
 * extension through jiti with moduleCache:false, replacing module singletons;
 * pinning on globalThis keeps live server connections and their cleanup
 * reachable from the re-imported module instead of orphaning them.
 */
export function getGlobalManager(): ServerManager | null {
  const holder = globalThis as Record<symbol, ServerManager | undefined>;
  return holder[GLOBAL_STATE_KEY] ?? null;
}

export function setGlobalManager(manager: ServerManager): void {
  (globalThis as Record<symbol, ServerManager | undefined>)[GLOBAL_STATE_KEY] = manager;
}

export function clearGlobalManager(): void {
  const holder = globalThis as Record<symbol, ServerManager | undefined>;
  holder[GLOBAL_STATE_KEY] = undefined;
}

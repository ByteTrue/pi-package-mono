// types.ts — shared shapes for @bytetrue/pi-mcp.
// Core interfaces follow pi-mcp-adapter's shapes (MIT) with the OAuth/UI/
// approval/scripting surface removed.
import type { ToolPrefix } from "./tool-naming.js";

/** One MCP server entry as written in any config layer. */
export interface ServerEntry {
  // stdio fields
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Inherit the adapter process environment for stdio servers. Defaults to true. */
  inheritEnv?: boolean;
  cwd?: string;
  // HTTP fields
  url?: string;
  headers?: Record<string, string>;
  // common
  /** Transport hint. Auto-detected from url/command when omitted. */
  type?: "stdio" | "http";
  disabled?: boolean;
  /** lifecycle: "lazy" (default) connects on first tool call; "eager" connects at load. */
  lifecycle?: "lazy" | "eager";
  /** Idle disconnect in seconds. Default 600; 0 disables. */
  idleTimeout?: number;
  /** Register tools from this server as direct Pi tools: true = all, or a list of original tool names. */
  directTools?: boolean | string[];
  /** include/exclude filters (glob-capable) applied to direct tools and proxy search/list/describe. */
  includeTools?: string[];
  excludeTools?: string[];
  /** Extra search vocabulary: key = original name / prefixed name / glob. */
  searchKeywords?: Record<string, string[]>;
  /** Per-server tool-name prefix mode. */
  toolPrefix?: ToolPrefix;
}

// Output guard tuning (settings.outputGuard object form) — upstream-compatible.
export interface McpOutputGuardSettings {
  /** Maximum inline MCP text output bytes before truncation/spill-to-disk. Defaults to 51200 (50 KiB). */
  maxBytes?: number;
  /** Maximum inline MCP text output lines before truncation/spill-to-disk. Defaults to 2000. */
  maxLines?: number;
  /** Maximum details.mcpResult JSON bytes kept raw; larger results are summarized and spilled to disk. Defaults to 16384 (16 KiB). */
  detailsMaxBytes?: number;
}

export interface McpSettings {
  idleTimeout?: number; // seconds, default 600, 0 to disable
  outputGuard?: McpOutputGuardSettings | boolean;
  toolPrefix?: ToolPrefix;
  /** Global default for direct-tools registration (per-server directTools overrides). */
  directTools?: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, ServerEntry>;
  settings?: McpSettings;
}

export interface MetadataCache {
  version: 1;
  servers: Record<string, ServerCacheEntry>;
}

/** Content blocks as the SDK returns them (text/image only in our surface). */
export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type ContentBlock = TextContent | ImageContent;

export interface ToolMetadata {
  name: string;           // Prefixed tool name (e.g., "xcodebuild_list_sims")
  originalName: string;   // Original MCP tool name (e.g., "list_sims")
  description: string;
  inputSchema?: unknown;  // JSON Schema for parameters (stored for describe/errors)
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptMetadata {
  serverName: string;
  originalName: string;
  commandName: string;
  title?: string;
  description: string;
  arguments: McpPromptArgument[];
}

/** On-disk cache shapes (upstream mcp-cache.json format). */
export interface CachedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface CachedPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface ServerCacheEntry {
  configHash: string;
  tools: CachedTool[];
  prompts?: CachedPrompt[];
  instructions?: string;
  cachedAt: number;
  ttlMs?: number;
}

export interface MetadataCache {
  version: 1;
  servers: Record<string, ServerCacheEntry>;
}

export type JsonObject = Record<string, unknown>;

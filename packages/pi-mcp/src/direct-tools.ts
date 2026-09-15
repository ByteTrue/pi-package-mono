// direct-tools.ts — register a curated subset of MCP tools as real Pi tools
// with real schemas, statically from the disk metadata cache at extension
// load (upstream resolveDirectTools semantics, MIT). No hot-loading: a
// reconnect or config change applies after the next extension load.
import type { ServerEntry, ToolMetadata, McpSettings, McpConfig } from "./types.js";
import { getToolNameCandidates, resolveToolPrefix } from "./tool-naming.js";
import { guardMcpOutput, resolveMcpOutputGuardOptions, guardedMcpDetails } from "./mcp-output-guard.js";
import type { ServerManager } from "./server-manager.js";

export interface DirectToolSpec {
  /** Pi tool name (prefixed). */
  name: string;
  server: string;
  originalName: string;
  description: string;
  inputSchema: unknown;
}

export function collectDirectTools(
  config: McpConfig,
  metadataFor: (server: string) => { tools: ToolMetadata[] } | null,
): DirectToolSpec[] {
  const specs: DirectToolSpec[] = [];
  const globalDirect = config.settings?.directTools === true;
  for (const [serverName, entry] of Object.entries(config.mcpServers)) {
    const wants = entry.directTools !== undefined ? entry.directTools : globalDirect;
    if (!wants) continue;
    const meta = metadataFor(serverName);
    if (!meta) continue;
    const prefix = resolveToolPrefix(entry, config.settings?.toolPrefix ?? "server");
    for (const tool of meta.tools) {
      if (Array.isArray(wants)) {
        // list form: match by original or prefixed names (upstream selector semantics)
        const candidates = getToolNameCandidates(tool.originalName, serverName, prefix);
        const matched = wants.some((w) => candidates.has(w));
        if (!matched) continue;
      }
      specs.push({
        name: tool.name,
        server: serverName,
        originalName: tool.originalName,
        description: tool.description || `MCP tool ${tool.originalName} from server ${serverName}`,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      });
    }
  }
  return specs;
}

export function makeDirectToolExecute(
  manager: ServerManager,
  spec: DirectToolSpec,
  settings: McpSettings,
): (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> {
  return async (args, signal) => {
    const client = await manager.clientFor(spec.server, signal);
    let result: { content?: unknown; isError?: boolean };
    try {
      result = (await client.callTool({ name: spec.originalName, arguments: args })) as {
        content?: unknown;
        isError?: boolean;
      };
    } catch (error) {
      throw new Error(`MCP call ${spec.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const content = Array.isArray(result.content) ? result.content : [];
    const guarded = await guardMcpOutput(content as never, {
      ...resolveMcpOutputGuardOptions(settings),
      rawMcpResult: result,
    });
    return {
      content: guarded.content,
      details: { mcpServer: spec.server, mcpTool: spec.originalName, ...guardedMcpDetails(guarded) },
    };
  };
}

/** Convert an MCP inputSchema to a Pi parameters object (pass-through with defaults). */
export function jsonSchemaToParameters(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const s = schema as Record<string, unknown>;
  return {
    type: "object",
    ...(s.properties !== undefined ? { properties: s.properties } : { properties: {} }),
    ...(Array.isArray(s.required) ? { required: s.required } : {}),
    ...(s.additionalProperties !== undefined ? { additionalProperties: s.additionalProperties } : {}),
  };
}

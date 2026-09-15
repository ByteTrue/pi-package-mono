// failure-backoff.ts — ported from pi-mcp-adapter's failure-backoff.ts (MIT),
// adapted to this package's state shape: servers in a fresh failure window are
// excluded from search until they reconnect.
export const FAILURE_BACKOFF_MS = 60 * 1000;

/** Minimal search-facing state: what tools are cached, config, and failures. */
export interface SearchState {
  toolMetadata: Map<string, import("./types.js").ToolMetadata[]>;
  config: {
    mcpServers: Record<string, import("./types.js").ServerEntry>;
    settings?: { toolPrefix?: import("./tool-naming.js").ToolPrefix };
  };
  /** Server name → failure timestamp (ms). */
  failureTracker: Map<string, number>;
  /** Server names with a live connection. */
  connectedServers: Set<string>;
  /** Optional server name → failure message. */
  failureMessages?: Map<string, string>;
}

export function getFailureAgeSeconds(state: SearchState, serverName: string): number | null {
  const failedAt = state.failureTracker.get(serverName);
  if (!failedAt) return null;
  const ageMs = Date.now() - failedAt;
  if (ageMs > FAILURE_BACKOFF_MS) return null;
  return Math.round(ageMs / 1000);
}

export function getFailureMessage(state: SearchState, serverName: string): string | null {
  if (getFailureAgeSeconds(state, serverName) === null) return null;
  return state.failureMessages?.get(serverName) ?? null;
}

export function isServerInActiveFailureBackoff(state: SearchState, serverName: string): boolean {
  return !state.connectedServers.has(serverName) && getFailureAgeSeconds(state, serverName) !== null;
}

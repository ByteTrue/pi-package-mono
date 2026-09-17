// mcp-panel.test.ts — observable panel behavior: state mapping from the
// manager/cache, name-query filtering, dirty tracking, and the save flow.
// TUI composition/colors need a real terminal and are covered by真机回归.
// Input is sent one key event at a time, matching real TUI delivery.
import { describe, expect, it } from "vitest";
import { openMcpPanel, type McpPanelCallbacks } from "./mcp-panel.js";
import { computeServerHash } from "./metadata-cache.js";
import type { MetadataCache } from "./types.js";

function callbacks(overrides: Partial<McpPanelCallbacks> = {}): McpPanelCallbacks {
  return {
    reconnect: async () => true,
    getConnectionStatus: () => "idle",
    getFailureMessage: () => null,
    refreshCacheAfterReconnect: () => null,
    ...overrides,
  };
}

const noopTui = { requestRender() {} };
const cache: MetadataCache = {
  version: 1,
  servers: {
    alpha: {
      configHash: computeServerHash({ command: "x" }),
      tools: [
        { name: "t1", description: "echo text" },
        { name: "t2", description: "write file" },
      ],
      cachedAt: Date.now(),
    },
    beta: { configHash: computeServerHash({ command: "y" }), tools: [{ name: "b1" }], cachedAt: Date.now() },
  },
};

function host(disabled = false) {
  return {
    config: {
      mcpServers: {
        alpha: { command: "x" },
        beta: { command: "y", ...(disabled ? { disabled: true } : {}) },
      },
    },
    cache,
  };
}

function type(panel: { handleInput(data: string): void }, text: string): void {
  for (const ch of text) panel.handleInput(ch);
}

describe("openMcpPanel state mapping", () => {
  it("lists servers with tools from a valid cache and disabled status", () => {
    let closed = false;
    const panel = openMcpPanel(host(true), callbacks(), noopTui, () => { closed = true; });
    const state = panel.getViewState();
    expect(state.servers.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(state.servers.find((s) => s.name === "beta")?.disabled).toBe(true);
    expect(state.servers.find((s) => s.name === "alpha")?.tools).toHaveLength(2);
    expect(state.servers.find((s) => s.name === "alpha")?.hasCachedData).toBe(true);
    expect(closed).toBe(false);
    panel.cleanup();
  });

  it("name query filters tool rows; escape clears it", () => {
    const panel = openMcpPanel(host(), callbacks(), noopTui, () => {});
    type(panel, "t2"); // matches tool name t2
    const filtered = panel.getViewState();
    expect(filtered.nameQuery).toBe("t2");
    const toolRows = filtered.visibleItems.filter((i) => i.type === "tool");
    expect(toolRows).toHaveLength(1);
    panel.handleInput("\x1b"); // esc clears query
    expect(panel.getViewState().nameQuery).toBe("");
    panel.cleanup();
  });

  it("space toggles direct selection and ctrl+s persists via callbacks", async () => {
    const applied: Array<{ name: string; selection: true | string[] | false }> = [];
    let closed: { cancelled: boolean } | null = null;
    const panel = openMcpPanel(
      host(),
      callbacks({
        applyDirectToolsChange: async (name, selection) => {
          applied.push({ name, selection });
          return true;
        },
      }),
      noopTui,
      (r) => { closed = r; },
    );

    panel.handleInput("\r"); // expand alpha
    expect(panel.getViewState().visibleItems.some((i) => i.type === "tool")).toBe(true);
    panel.handleInput("\x1b[B"); // down to first tool
    panel.handleInput(" "); // toggle direct
    expect(panel.getViewState().dirty).toBe(true);

    panel.handleInput("\x13"); // ctrl+s
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([{ name: "alpha", selection: ["t1"] }]);
    expect(panel.getViewState().dirty).toBe(false);
    panel.cleanup();
  });

  it("ctrl+d toggles disabled and ctrl+s persists the flip", async () => {
    const disabledCalls: Array<{ name: string; disabled: boolean }> = [];
    const panel = openMcpPanel(
      host(),
      callbacks({
        applyDisabledChange: async (name, disabled) => {
          disabledCalls.push({ name, disabled });
          return true;
        },
      }),
      noopTui,
      () => {},
    );
    panel.handleInput("\x04"); // ctrl+d on alpha server row
    expect(panel.getViewState().servers.find((s) => s.name === "alpha")?.disabled).toBe(true);
    panel.handleInput("\x13"); // ctrl+s
    await Promise.resolve();
    await Promise.resolve();
    expect(disabledCalls).toEqual([{ name: "alpha", disabled: true }]);
    panel.cleanup();
  });

  it("renders TUI lines via the Component contract with a stable height", () => {
    const panel = openMcpPanel(host(), callbacks(), noopTui, () => {});
    const lines = panel.render(80);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.join("\n")).toContain("MCP Servers");
    // Height stays stable across content changes: no ghost rows from diff rendering.
    const first = panel.render(80).length;
    panel.handleInput("?"); // desc search changes content shape
    const second = panel.render(80).length;
    expect(second).toBe(first);
    panel.invalidate();
    panel.cleanup();
  });

  it("panel height is stable across notice transitions", async () => {
    const panel = openMcpPanel(host(), callbacks(), noopTui, () => {});
    const before = panel.render(80).length;
    panel.handleInput("\x13"); // ctrl+s → commitChanges sets a notice
    await Promise.resolve();
    await Promise.resolve();
    const state = panel.getViewState();
    expect(state.notice).toContain("No changes to write.");
    const after = panel.render(80).length;
    expect(after).toBe(before);
    panel.cleanup();
  });

  it("ctrl+r reconnects all enabled servers, not just the cursor one", async () => {
    const reconnected: string[] = [];
    const panel = openMcpPanel(
      host(),
      callbacks({
        reconnect: async (name) => {
          reconnected.push(name);
          return true;
        },
        getConnectionStatus: () => "connected",
      }),
      noopTui,
      () => {},
    );
    panel.handleInput("\x12"); // ctrl+r
    await Promise.resolve();
    await Promise.all(panel.getViewState().servers.map(() => Promise.resolve()));
    await new Promise((r) => setTimeout(r, 0));
    expect(reconnected.sort()).toEqual(["alpha", "beta"]);
    const state = panel.getViewState();
    // Upstream semantics: progress lives in row status labels, not a notice
    // row — so panel height never jumps mid-reconnect (pi-tui diff safety).
    expect(state.notice ?? "").toBe("");
    expect(state.servers.every((s) => s.connectionStatus === "connected")).toBe(true);
    panel.cleanup();
  });

  it("escape with unsaved changes asks for discard confirmation; keep closes", async () => {
    let closed: { cancelled: boolean } | null = null;
    const panel = openMcpPanel(host(), callbacks(), noopTui, (r) => { closed = r; });
    panel.handleInput("\x04"); // make dirty
    panel.handleInput("\x1b"); // esc
    expect(panel.getViewState().confirmingDiscard).toBe(true);
    panel.handleInput("\r"); // keep & close (default selection = 1)
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toEqual({ cancelled: false });
  });
});

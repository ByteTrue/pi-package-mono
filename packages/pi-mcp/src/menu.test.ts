// menu.test.ts — Unit tests for the native Pi dialog-based MCP menu.
import { describe, expect, it, vi } from "vitest";
import { runMcpMenu } from "./menu.js";
import { ServerManager } from "./server-manager.js";
import type { McpConfig, ServerEntry } from "./types.js";

function makeMockUi() {
  return {
    select: vi.fn(),
    confirm: vi.fn(),
    input: vi.fn(),
    editor: vi.fn(),
    notify: vi.fn(),
  };
}

function entry(partial: Partial<ServerEntry> = {}): ServerEntry {
  return { command: "echo", ...partial } as ServerEntry;
}

describe("runMcpMenu", () => {
  it("does nothing if ctx.ui is missing", async () => {
    const manager = new ServerManager({ config: {} });
    await expect(runMcpMenu(manager, { mcpServers: {} }, {})).resolves.toBeUndefined();
  });

  it("exits immediately when user selects Exit or cancels", async () => {
    const manager = new ServerManager({
      config: { s1: entry({}), s2: entry({ disabled: true }) },
    });
    const config: McpConfig = {
      mcpServers: { s1: entry({}), s2: entry({ disabled: true }) },
    };

    const ui = makeMockUi();
    ui.select.mockResolvedValueOnce("✕ Exit");

    await runMcpMenu(manager, config, { ui: ui as never });

    expect(ui.select).toHaveBeenCalledTimes(1);
    const [title, choices] = ui.select.mock.calls[0]!;
    expect(title).toContain("MCP Management (1 enabled, 0 connected, 1 disabled)");
    expect(choices.some((c: string) => c.includes("s1") && c.includes("not connected"))).toBe(true);
    expect(choices.some((c: string) => c.includes("s2") && c.includes("disabled"))).toBe(true);
  });

  it("handles Reconnect all servers choice", async () => {
    const manager = new ServerManager({
      config: { a: entry({}), b: entry({ disabled: true }) },
    });
    const config: McpConfig = {
      mcpServers: { a: entry({}), b: entry({ disabled: true }) },
    };

    const reconnectSpy = vi.spyOn(manager, "reconnect").mockResolvedValue({
      client: {} as never,
      connectedAt: Date.now(),
      tools: [{ name: "a_t1", originalName: "t1", description: "test tool" }],
      prompts: [],
    });

    const ui = makeMockUi();
    // First select: click reconnect all; second select: exit
    ui.select
      .mockResolvedValueOnce("🔄 Reconnect all servers (1 enabled)")
      .mockResolvedValueOnce("✕ Exit");

    await runMcpMenu(manager, config, { ui: ui as never });

    expect(reconnectSpy).toHaveBeenCalledWith("a");
    expect(reconnectSpy).not.toHaveBeenCalledWith("b"); // disabled server not reconnected
    expect(ui.notify).toHaveBeenCalledWith("Reconnected all 1 servers.", "info");
  });

  it("handles Browse all tools", async () => {
    const manager = new ServerManager({ config: { a: entry({}) } });
    const config: McpConfig = { mcpServers: { a: entry({}) } };

    const ui = makeMockUi();
    ui.select
      .mockResolvedValueOnce("📋 Browse all tools (0)")
      .mockResolvedValueOnce("✕ Exit");

    await runMcpMenu(manager, config, { ui: ui as never });

    expect(ui.editor).toHaveBeenCalledWith("All MCP Tools", expect.any(String));
  });

  it("handles Browse all prompts", async () => {
    const manager = new ServerManager({ config: { a: entry({}) } });
    const config: McpConfig = { mcpServers: { a: entry({}) } };

    const ui = makeMockUi();
    ui.select
      .mockResolvedValueOnce("💬 Browse all prompts")
      .mockResolvedValueOnce("✕ Exit");

    await runMcpMenu(manager, config, { ui: ui as never });

    expect(ui.editor).toHaveBeenCalledWith("All MCP Prompts", expect.any(String));
  });

  it("handles Search tools", async () => {
    const manager = new ServerManager({ config: { a: entry({}) } });
    const config: McpConfig = { mcpServers: { a: entry({}) } };

    const ui = makeMockUi();
    ui.select
      .mockResolvedValueOnce("🔍 Search tools...")
      .mockResolvedValueOnce("✕ Exit");
    ui.input.mockResolvedValueOnce("test");

    await runMcpMenu(manager, config, { ui: ui as never });

    expect(ui.input).toHaveBeenCalledWith("Search MCP Tools", "keyword or pattern...");
  });

  it("navigates into server menu and can reconnect single server", async () => {
    const manager = new ServerManager({ config: { srv: entry({}) } });
    const config: McpConfig = { mcpServers: { srv: entry({}) } };

    const reconnectSpy = vi.spyOn(manager, "reconnect").mockResolvedValue({
      client: {} as never,
      connectedAt: Date.now(),
      tools: [{ name: "srv_echo", originalName: "echo", description: "" }],
      prompts: [],
    });

    const ui = makeMockUi();
    // 1. Pick server row in main menu
    // 2. Pick Connect/Reconnect in server menu
    // 3. Pick Back in server menu
    // 4. Pick Exit in main menu
    ui.select
      .mockImplementationOnce((_t, choices: string[]) => choices[0]) // pick server row
      .mockResolvedValueOnce("⚡ Connect")
      .mockResolvedValueOnce("← Back")
      .mockResolvedValueOnce("✕ Exit");

    await runMcpMenu(manager, config, { ui: ui as never });

    expect(reconnectSpy).toHaveBeenCalledWith("srv");
    expect(ui.notify).toHaveBeenCalledWith("Connected srv: 1 tools.", "info");
  });
});

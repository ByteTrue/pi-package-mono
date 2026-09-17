// menu.test.ts — Unit tests for the native Pi dialog-based MCP menu
// and the paginated tool browser with 10 tools per page.
import { describe, expect, it, vi } from "vitest";
import { runMcpMenu, runPaginatedToolBrowser } from "./menu.js";
import { ServerManager } from "./server-manager.js";
import type { McpConfig, ServerEntry } from "./types.js";

function makeMockUi() {
  return {
    select: vi.fn(),
    confirm: vi.fn(),
    input: vi.fn(),
    editor: vi.fn(),
    notify: vi.fn(),
    custom: vi.fn(),
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
    ui.select
      .mockResolvedValueOnce("🔄 Reconnect all servers (1 enabled)")
      .mockResolvedValueOnce("✕ Exit");

    await runMcpMenu(manager, config, { ui: ui as never });

    expect(reconnectSpy).toHaveBeenCalledWith("a");
    expect(reconnectSpy).not.toHaveBeenCalledWith("b"); // disabled server not reconnected
    expect(ui.notify).toHaveBeenCalledWith("Reconnected all 1 servers.", "info");
  });

  it("handles Browse all tools when no tools available", async () => {
    const manager = new ServerManager({ config: { a: entry({}) } });
    const config: McpConfig = { mcpServers: { a: entry({}) } };

    const ui = makeMockUi();
    ui.select
      .mockResolvedValueOnce("📋 Browse all tools (0)")
      .mockResolvedValueOnce("✕ Exit");

    await runMcpMenu(manager, config, { ui: ui as never });

    expect(ui.notify).toHaveBeenCalledWith(
      "No MCP tools available across enabled servers.",
      "info",
    );
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

describe("runPaginatedToolBrowser", () => {
  it("does nothing if tools array is empty or ui missing", async () => {
    const ui = makeMockUi();
    await expect(runPaginatedToolBrowser([], "Empty", { ui: ui as never })).resolves.toBeUndefined();
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("paginates tools 10 per page, supports left/right arrows, enter to inspect, and escape to exit", async () => {
    const tools = Array.from({ length: 25 }, (_, i) => ({
      name: `tool_${i + 1}`,
      serverName: "test-srv",
      description: `Description for tool ${i + 1}`,
      inputSchema: { type: "object", properties: { param1: { type: "string" } } },
    }));

    const ui = makeMockUi();
    const tuiMock = { requestRender: vi.fn() };
    const themeMock = {
      fg: vi.fn((_type: string, text: string) => text),
      bold: vi.fn((text: string) => text),
    };

    let sessionStep = 0;
    ui.custom.mockImplementation((factory: (tui: unknown, theme: unknown, kb: unknown, done: (val: unknown) => void) => {
      render: (w: number) => string[];
      handleInput: (data: string) => void;
    }) => {
      sessionStep++;
      let doneVal: unknown;
      const done = (val: unknown) => { doneVal = val; };
      const comp = factory(tuiMock, themeMock, {}, done);

      // Verify rendering at 100 width: 16 lines exactly
      const lines = comp.render(100);
      expect(lines.length).toBe(16);
      expect(lines.some((l: string) => l.includes("Page 1/3") || l.includes("Page 2/3"))).toBe(true);

      if (sessionStep === 1) {
        // Press right arrow to flip to Page 2
        comp.handleInput("\x1b[C");
        expect(tuiMock.requestRender).toHaveBeenCalled();
        const p2Lines = comp.render(100);
        expect(p2Lines.some((l: string) => l.includes("Page 2/3"))).toBe(true);
        expect(p2Lines.some((l: string) => l.includes("tool_11"))).toBe(true);

        // Press Enter on the first item of page 2 (tool_11)
        comp.handleInput("\r");
        return Promise.resolve(doneVal);
      } else {
        // Returned after inspecting tool in editor! Now press Esc to exit
        comp.handleInput("\x1b");
        return Promise.resolve(doneVal);
      }
    });

    await runPaginatedToolBrowser(tools, "Test Tools", { ui: ui as never });

    expect(ui.custom).toHaveBeenCalledTimes(2);
    expect(ui.editor).toHaveBeenCalledTimes(1);
    const [editorTitle, editorDetails] = ui.editor.mock.calls[0]!;
    expect(editorTitle).toBe("Tool — tool_11");
    expect(editorDetails).toContain("Tool: tool_11");
    expect(editorDetails).toContain("Server: test-srv");
    expect(editorDetails).toContain("param1");
  });
});

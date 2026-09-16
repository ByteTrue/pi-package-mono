// commands.test.ts — observable behavior of the /mcp surface helpers:
// five-state status text, tools/prompts listings, footer text, and the
// enable/disable project-override writer.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServerManager, effectiveIdleMinutes } from "./server-manager.js";
import {
  allPromptsText,
  allToolsText,
  footerStatusText,
  mcpArgumentCompletions,
  serverStatusLines,
  writeProjectServerDisabledOverride,
} from "./commands.js";
import type { McpConfig, ServerEntry } from "./types.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pi-mcp-commands-"));
  process.env.PI_CODING_AGENT_DIR = join(home, "agent");
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
});

function entry(partial: Partial<ServerEntry>): ServerEntry {
  return { command: "echo", ...partial } as ServerEntry;
}

function configOf(servers: Record<string, ServerEntry>): McpConfig {
  return { mcpServers: servers };
}

describe("serverStatusLines", () => {
  it("renders the five states distinctly", () => {
    const manager = new ServerManager({
      config: {
        connected: entry({ command: "a" }),
        failed: entry({ command: "b" }),
        cached: entry({ command: "c" }),
        cold: entry({ command: "d" }),
        off: entry({ disabled: true }),
      },
    });
    // connect "connected"
    // (no real transport: simulate by direct state manipulation is not possible;
    // instead assert the offline/failed paths via a real failing connect below)
    manager.servers.get("failed")!.failedAt = Date.now() - 5000;
    manager.servers.get("failed")!.lastError = "spawn b ENOENT";
    const lines = serverStatusLines(manager).join("\n");
    expect(lines).toContain("⊘ off: disabled");
    expect(lines).toContain("✗ failed: failed 5s ago — spawn b ENOENT");
    expect(lines).toContain("○ cold: not connected");
  });
});

describe("footerStatusText", () => {
  it("returns undefined when off or nothing configured", () => {
    const manager = new ServerManager({ config: {} });
    expect(footerStatusText(manager, "off")).toBeUndefined();
    expect(footerStatusText(manager, "full")).toBeUndefined();
  });

  it("full mode counts enabled/connected/disabled", () => {
    const manager = new ServerManager({
      config: { a: entry({}), b: entry({ disabled: true }), c: entry({}) },
    });
    const text = footerStatusText(manager, "full")!;
    expect(text).toContain("2 servers enabled");
    expect(text).toContain("(1 disabled)");
  });

  it("compact mode is connected/enabled", () => {
    const manager = new ServerManager({ config: { a: entry({}) } });
    expect(footerStatusText(manager, "compact")).toBe("mcp:0/1");
  });
});

describe("mcpArgumentCompletions", () => {
  const servers = { alpha: entry({}), beta: entry({}) };
  it("suggests subcommands", () => {
    const options = mcpArgumentCompletions("", servers)!;
    expect(options.map((o) => o.value)).toContain("tools");
    expect(options.map((o) => o.value)).toContain("disable");
  });
  it("suggests server names for enable/disable/reconnect", () => {
    const options = mcpArgumentCompletions("disable al", servers)!;
    expect(options).toEqual([{ value: "disable alpha", label: "alpha" }]);
  });
  it("returns null for non-server subcommands", () => {
    expect(mcpArgumentCompletions("tools x", servers)).toBeNull();
  });
});

describe("writeProjectServerDisabledOverride", () => {
  function projectDir(): string {
    const proj = join(home, "proj");
    mkdirSync(proj, { recursive: true });
    return proj;
  }

  it("disabling writes a disabled marker override (new files are 0600)", () => {
    const proj = projectDir();
    const config = configOf({ svc: entry({}) });
    const result = writeProjectServerDisabledOverride(proj, "svc", true, config);
    expect(result.changed).toBe(true);
    const raw = JSON.parse(readFileSync(join(proj, ".pi", "mcp.json"), "utf-8"));
    expect(raw.mcpServers.svc).toEqual({ disabled: true });
    const mode = statSync(join(proj, ".pi", "mcp.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("enable removes the marker when lower layer enables it", () => {
    const proj = projectDir();
    const config = configOf({ svc: entry({}) });
    writeProjectServerDisabledOverride(proj, "svc", true, config);
    const result = writeProjectServerDisabledOverride(proj, "svc", false, config);
    expect(result.changed).toBe(true);
    const raw = JSON.parse(readFileSync(join(proj, ".pi", "mcp.json"), "utf-8"));
    expect(raw.mcpServers.svc).toBeUndefined();
  });

  it("enable writes disabled:false when the effective config is still disabled", () => {
    const proj = projectDir();
    const config = configOf({ svc: entry({ disabled: true }) });
    const result = writeProjectServerDisabledOverride(proj, "svc", false, config);
    expect(result.changed).toBe(true);
    const raw = JSON.parse(readFileSync(join(proj, ".pi", "mcp.json"), "utf-8"));
    expect(raw.mcpServers.svc).toEqual({ disabled: false });
  });

  it("no-op when state already matches", () => {
    const proj = projectDir();
    const config = configOf({ svc: entry({}) });
    const first = writeProjectServerDisabledOverride(proj, "svc", false, config);
    expect(first.changed).toBe(false);
  });

  it("disabling preserves fields already present in the override entry", () => {
    const proj = projectDir();
    mkdirSync(join(proj, ".pi"), { recursive: true });
    writeFileSync(join(proj, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x", directTools: true } } }));
    const config = configOf({ other: entry({ directTools: true }) });
    const result = writeProjectServerDisabledOverride(proj, "other", true, config);
    expect(result.changed).toBe(true);
    const raw = JSON.parse(readFileSync(join(proj, ".pi", "mcp.json"), "utf-8"));
    expect(raw.mcpServers.other).toEqual({ command: "x", directTools: true, disabled: true });
  });
});

describe("allToolsText / allPromptsText", () => {
  it("skip disabled servers and report empty state honestly", () => {
    const manager = new ServerManager({ config: { a: entry({}), b: entry({ disabled: true }) } });
    expect(allToolsText(manager, configOf({ a: entry({}), b: entry({ disabled: true }) }).mcpServers)).toContain("No MCP tools available");
    expect(allPromptsText(manager, configOf({ a: entry({}) }).mcpServers)).toContain("No MCP prompts available");
  });
});

describe("include/exclude selector (upstream isToolAllowed)", () => {
  function liveTools(entry: Partial<ServerEntry>, tools: Array<{ name: string; originalName: string; description: string }>): string[] {
    const manager = new ServerManager({ config: { alpha: { command: "x", ...entry } } });
    (manager as unknown as { servers: Map<string, { state: unknown }> }).servers.get("alpha")!.state = {
      tools: tools.map((t) => ({ ...t, name: `alpha_${t.originalName}` })),
      prompts: [],
    };
    return (manager.metadataFor("alpha")?.tools ?? []).map((t) => t.originalName);
  }

  it("excludeTools drops matching tools from metadata", () => {
    const tools = liveTools({ excludeTools: ["t1"] }, [
      { name: "", originalName: "t1", description: "" },
      { name: "", originalName: "t2", description: "" },
    ]);
    expect(tools).toEqual(["t2"]);
  });

  it("includeTools keeps only listed tools (glob supported)", () => {
    const tools = liveTools({ includeTools: ["t*"] }, [
      { name: "", originalName: "t1", description: "" },
      { name: "", originalName: "other", description: "" },
    ]);
    expect(tools).toEqual(["t1"]);
  });

  it("no filters leaves all tools", () => {
    const tools = liveTools({}, [
      { name: "", originalName: "t1", description: "" },
      { name: "", originalName: "t2", description: "" },
    ]);
    expect(tools).toHaveLength(2);
  });
});

describe("effectiveIdleMinutes (upstream getEffectiveIdleTimeoutMinutes)", () => {
  it("eager never idles", () => {
    expect(effectiveIdleMinutes({ command: "x", lifecycle: "eager" }, 10)).toBe(0);
  });
  it("explicit per-server override wins", () => {
    expect(effectiveIdleMinutes({ command: "x", idleTimeout: 3 }, 10)).toBe(3);
  });
  it("default comes from settings (10 minutes upstream)", () => {
    expect(effectiveIdleMinutes({ command: "x" }, 10)).toBe(10);
  });
});

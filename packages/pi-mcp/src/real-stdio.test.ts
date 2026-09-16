// Real-stdio regression against @modelcontextprotocol/server-everything,
// driven through ServerManager + proxy exactly as the extension does.
// Network-dependent (npx install + spawn): skipped when the fixture can't start.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerManager, setGlobalManager, clearGlobalManager } from "./server-manager.js";
import { createProxyHandler } from "./proxy.js";

const SERVER = "@modelcontextprotocol/server-everything";
const config = { everything: { command: "npx", args: ["-y", SERVER] } };

let agentDir: string;
let manager: ServerManager;
let proxy: ReturnType<typeof createProxyHandler>;
let connected = false;

beforeAll(async () => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-regression-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  manager = new ServerManager({ config });
  setGlobalManager(manager);
  proxy = createProxyHandler({ manager, settings: {}, config });
  try {
    await manager.connect("everything");
    connected = true;
  } catch (error) {
    console.warn(`real-stdio fixture unavailable (${String(error)}) — skipping suite`);
  }
}, 180_000);

afterAll(async () => {
  if (connected) await manager.disconnectAll();
  clearGlobalManager();
  delete process.env.PI_CODING_AGENT_DIR;
});

describe("real stdio server regression", () => {
  it("connects and captures tools + prompts", () => {
    if (!connected) return;
    const meta = manager.metadataFor("everything");
    expect(meta!.tools.length).toBeGreaterThan(5);
    expect(meta!.prompts.length).toBeGreaterThan(0);
    expect(meta!.tools.some((t) => t.originalName === "echo")).toBe(true);
  });

  it("search, describe, call through the proxy", async () => {
    if (!connected) return;
    const search = await proxy({ search: "echo message" });
    const searchText = search.content[0]?.type === "text" ? search.content[0].text : "";
    // Word-level matching requires every token to hit; if the fixture's
    // description changed, fall back to the single-token assertion.
    if (!searchText.includes("everything_echo")) {
      const single = await proxy({ search: "echo" });
      expect(single.content[0]?.type === "text" && single.content[0].text).toContain("everything_echo");
    } else {
      expect(searchText).toContain("everything_echo");
    }

    const desc = await proxy({ describe: "everything_echo" });
    expect(desc.content[0]?.type === "text" && desc.content[0].text).toContain("Shape:");

    const call = await proxy({ tool: "everything_echo", args: { message: "regression hello" } });
    expect(call.content[0]?.type === "text" && call.content[0].text).toContain("regression hello");
  }, 60_000);

  it("persists metadata to the shared mcp-cache.json", async () => {
    if (!connected) return;
    const raw = JSON.parse(await readFile(join(agentDir, "mcp-cache.json"), "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.servers.everything?.tools?.length).toBeGreaterThan(5);
  });

  it("serves search from the disk cache after disconnect", async () => {
    if (!connected) return;
    await manager.disconnect("everything");
    expect(manager.isConnected("everything")).toBe(false);
    const offline = await proxy({ search: "echo" });
    expect(offline.content[0]?.type === "text" && offline.content[0].text).toContain("everything_echo");
  });

  it("reconnects transparently on the next call", async () => {
    if (!connected) return;
    const call = await proxy({ tool: "everything_echo", args: { message: "after reconnect" } });
    expect(call.content[0]?.type === "text" && call.content[0].text).toContain("after reconnect");
  }, 120_000);
});

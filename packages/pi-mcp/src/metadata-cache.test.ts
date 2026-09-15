import { describe, it, expect } from "vitest";
import {
  loadMetadataCache,
  saveMetadataCache,
  getMetadataCachePath,
  computeServerHash,
  isServerCacheValid,
  reconstructToolMetadata,
  reconstructPromptMetadata,
  getCachedMetadataForConfig,
} from "./metadata-cache.js";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { MetadataCache, ServerCacheEntry, ServerEntry, McpConfig } from "./types.js";

function withAgentDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-cache-test-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
  }
}

function sampleEntry(hash: string): ServerCacheEntry {
  return {
    configHash: hash,
    tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
    prompts: [{ name: "review", description: "Review", arguments: [{ name: "topic", required: true }] }],
    instructions: "Use echo wisely",
    cachedAt: Date.now(),
  };
}

describe("computeServerHash (upstream parity)", () => {
  it("is stable across field order and ignores runtime-only fields", () => {
    const a = computeServerHash({ command: "npx", args: ["-y", "x"], env: { B: "2", A: "1" } });
    const b = computeServerHash({ env: { A: "1", B: "2" }, args: ["-y", "x"], command: "npx" });
    expect(a).toBe(b);
    // runtime behavior fields don't affect identity
    const c = computeServerHash({ command: "npx", args: ["-y", "x"], env: { B: "2", A: "1" }, idleTimeout: 99, lifecycle: "eager" });
    expect(a).toBe(c);
  });

  it("changes when identity fields change", () => {
    expect(computeServerHash({ command: "npx", args: ["-y", "x@1"] })).not.toBe(
      computeServerHash({ command: "npx", args: ["-y", "x@2"] }),
    );
  });
});

describe("loadMetadataCache / saveMetadataCache", () => {
  it("round-trips entries (upstream v1 format, mcp-cache.json)", () => {
    withAgentDir((dir) => {
      const cache: MetadataCache = { version: 1, servers: { srv: sampleEntry("h1") } };
      saveMetadataCache(cache);
      const path = getMetadataCachePath();
      expect(path).toBe(join(dir, "mcp-cache.json"));
      const back = loadMetadataCache();
      expect(back?.servers["srv"]?.tools[0]?.name).toBe("echo");
      expect(back?.servers["srv"]?.prompts?.[0]?.name).toBe("review");
      expect(back?.servers["srv"]?.instructions).toBe("Use echo wisely");
    });
  });

  it("merges into an existing cache instead of replacing it", () => {
    withAgentDir(() => {
      saveMetadataCache({ version: 1, servers: { a: sampleEntry("ha") } });
      saveMetadataCache({ version: 1, servers: { b: sampleEntry("hb") } });
      const back = loadMetadataCache();
      expect(Object.keys(back?.servers ?? {}).sort()).toEqual(["a", "b"]);
    });
  });

  it("returns null on damaged or wrong-version cache", () => {
    withAgentDir((dir) => {
      writeFileSync(join(dir, "mcp-cache.json"), "{not json");
      expect(loadMetadataCache()).toBeNull();
      writeFileSync(join(dir, "mcp-cache.json"), JSON.stringify({ version: 99, servers: {} }));
      expect(loadMetadataCache()).toBeNull();
    });
  });
});

describe("isServerCacheValid", () => {
  it("validates on hash match and fresh cachedAt; invalidates otherwise", () => {
    const definition: ServerEntry = { command: "npx", args: ["-y", "x"] };
    const hash = computeServerHash(definition);
    expect(isServerCacheValid(sampleEntry(hash), definition)).toBe(true);
    expect(isServerCacheValid(sampleEntry("wrong"), definition)).toBe(false);
    const stale = { ...sampleEntry(hash), cachedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 };
    expect(isServerCacheValid(stale, definition)).toBe(false);
  });
});

describe("reconstructToolMetadata / reconstructPromptMetadata", () => {
  it("applies prefixes and include/exclude filters", () => {
    const entry: ServerCacheEntry = {
      configHash: "h",
      cachedAt: Date.now(),
      tools: [
        { name: "search_code" },
        { name: "get_file_contents" },
        { name: "get_bad" },
      ],
      prompts: [{ name: "review" }],
    };
    const definition = { includeTools: ["get_*"], excludeTools: ["get_bad"] };
    const tools = reconstructToolMetadata("github", entry, "server", definition);
    expect(tools.map((t) => t.name)).toEqual(["github_get_file_contents"]);
    expect(tools[0]?.originalName).toBe("get_file_contents");

    const prompts = reconstructPromptMetadata("github", entry.prompts ?? [], "server", {});
    expect(prompts[0]?.commandName).toBe("mcp__github__review");
    expect(prompts[0]?.originalName).toBe("review");
  });
});

describe("getCachedMetadataForConfig", () => {
  it("returns only configured+valid servers", () => {
    withAgentDir(() => {
      const config: McpConfig = {
        mcpServers: {
          ok: { command: "npx", args: ["-y", "x"] },
          changed: { command: "npx", args: ["-y", "y"] },
          disabled: { command: "npx", args: ["-y", "x"], disabled: true },
        },
      };
      const cache: MetadataCache = {
        version: 1,
        servers: {
          ok: sampleEntry(computeServerHash(config.mcpServers["ok"]!)),
          changed: sampleEntry(computeServerHash({ command: "npx", args: ["-y", "OLD"] })),
        },
      };
      mkdirSync(dirname(getMetadataCachePath()), { recursive: true });
      writeFileSync(getMetadataCachePath(), JSON.stringify(cache));
      const got = getCachedMetadataForConfig(config, loadMetadataCache());
      expect([...got.keys()]).toEqual(["ok"]);
      expect(existsSync(getMetadataCachePath())).toBe(true);
    });
  });
});

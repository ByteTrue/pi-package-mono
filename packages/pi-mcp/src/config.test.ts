import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpConfig, mergeConfigs, getConfigSources, type ConfigSource } from "./config.js";

function withTempHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "pi-mcp-config-test-"));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn(home);
  } finally {
    process.env.HOME = oldHome;
  }
}

function writeConfig(home: string, rel: string, data: unknown) {
  const p = join(home, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(data));
}

describe("mergeConfigs", () => {
  it("overlay wins same-name servers and merges settings", () => {
    const base = {
      mcpServers: {
        a: { command: "node", args: ["a.js"] },
        b: { command: "node", args: ["b.js"] },
      },
      settings: { idleTimeout: 100 },
    };
    const overlay = {
      mcpServers: { b: { command: "node", args: ["b2.js"] }, c: { url: "http://x/mcp" } },
      settings: { outputGuard: { maxBytes: 12345 } },
    };
    const merged = mergeConfigs(base, overlay);
    expect(merged.mcpServers["a"]?.args).toEqual(["a.js"]);
    expect(merged.mcpServers["b"]?.args).toEqual(["b2.js"]);
    expect(merged.mcpServers["c"]?.url).toBe("http://x/mcp");
    expect(merged.settings).toEqual({ idleTimeout: 100, outputGuard: { maxBytes: 12345 } });
  });

  it("a disabled overlay entry disables an inherited server", () => {
    const merged = mergeConfigs(
      { mcpServers: { a: { command: "node" } } },
      { mcpServers: { a: { command: "node", disabled: true } } },
    );
    expect(merged.mcpServers["a"]?.disabled).toBe(true);
  });
});

describe("loadMcpConfig layering", () => {
  it("resolves sources low→high: shared-global, .agents, pi-global, project, pi-project", () => {
    withTempHome((home) => {
      const agentDir = join(home, ".pi", "agent");
      const proj = join(home, "proj");
      mkdirSync(join(proj, ".pi"), { recursive: true });
      process.env.PI_CODING_AGENT_DIR = agentDir;
      try {
        writeConfig(home, ".config/mcp/mcp.json", {
          mcpServers: { shared: { command: "s" }, common: { command: "s1" } },
        });
        writeConfig(home, ".agents/mcp.json", {
          mcpServers: { agents: { command: "a" }, common: { command: "s2" } },
        });
        writeConfig(agentDir, "mcp.json", {
          mcpServers: { piglobal: { command: "p" }, common: { command: "s3" } },
        });
        writeConfig(proj, ".mcp.json", {
          mcpServers: { project: { command: "j" }, common: { command: "s4" } },
        });
        writeConfig(proj, ".pi/mcp.json", {
          mcpServers: { piproject: { command: "pj" }, common: { command: "s5" } },
        });

        const config = loadMcpConfig(proj);
        expect(Object.keys(config.mcpServers).sort()).toEqual(
          ["agents", "common", "piproject", "piglobal", "project", "shared"].sort(),
        );
        // highest layer wins for `common`
        expect(config.mcpServers["common"]?.command).toBe("s5");
      } finally {
        delete process.env.PI_CODING_AGENT_DIR;
      }
    });
  });

  it("keeps disabled servers marked, not filtered", () => {
    withTempHome((home) => {
      const proj = join(home, "proj");
      mkdirSync(proj, { recursive: true });
      writeConfig(home, ".config/mcp/mcp.json", {
        mcpServers: { keep: { command: "k" }, drop: { command: "d" } },
      });
      writeConfig(proj, ".mcp.json", { mcpServers: { drop: { command: "d", disabled: true } } });
      const config = loadMcpConfig(proj);
      expect(Object.keys(config.mcpServers).sort()).toEqual(["drop", "keep"]);
      expect(config.mcpServers["drop"]?.disabled).toBe(true);
      expect(config.mcpServers["keep"]?.disabled).toBeUndefined();
    });
  });

  it("bare disabled marker from a higher layer disables an inherited server", () => {
    withTempHome((home) => {
      const proj = join(home, "proj");
      mkdirSync(proj, { recursive: true });
      writeConfig(home, ".config/mcp/mcp.json", { mcpServers: { svc: { command: "k" } } });
      writeConfig(proj, ".pi/mcp.json", { mcpServers: { svc: { disabled: true } } });
      const config = loadMcpConfig(proj);
      expect(config.mcpServers["svc"]?.disabled).toBe(true);
      expect(config.mcpServers["svc"]?.command).toBe("k");
    });
  });

  it("disabled: false in a higher layer re-enables an inherited server", () => {
    withTempHome((home) => {
      const proj = join(home, "proj");
      mkdirSync(proj, { recursive: true });
      writeConfig(home, ".config/mcp/mcp.json", { mcpServers: { svc: { command: "k", disabled: true } } });
      writeConfig(proj, ".pi/mcp.json", { mcpServers: { svc: { disabled: false } } });
      const config = loadMcpConfig(proj);
      expect(config.mcpServers["svc"]?.disabled).toBe(false);
      expect(config.mcpServers["svc"]?.command).toBe("k");
    });
  });

  it("headers are not inherited when a higher layer repoints a server at a new url", () => {
    withTempHome((home) => {
      const proj = join(home, "proj");
      mkdirSync(proj, { recursive: true });
      writeConfig(home, ".config/mcp/mcp.json", {
        mcpServers: { api: { url: "https://old.example.com/mcp", headers: { Authorization: "Bearer old" } } },
      });
      writeConfig(proj, ".mcp.json", { mcpServers: { api: { url: "https://new.example.com/mcp" } } });
      const config = loadMcpConfig(proj);
      expect(config.mcpServers["api"]?.url).toBe("https://new.example.com/mcp");
      expect(config.mcpServers["api"]?.headers).toBeUndefined();
    });
  });

  it("parses mcpFooterStatus and mcpTrace settings", () => {
    withTempHome((home) => {
      const proj = join(home, "proj");
      mkdirSync(proj, { recursive: true });
      writeConfig(proj, ".mcp.json", {
        mcpServers: {},
        settings: { mcpFooterStatus: "compact", trace: { enabled: true, file: "trace.jsonl", maxBytes: 1024 } },
      });
      const config = loadMcpConfig(proj);
      expect(config.settings?.mcpFooterStatus).toBe("compact");
      expect(config.settings?.trace).toEqual({ enabled: true, file: "trace.jsonl", maxBytes: 1024 });
    });
  });

  it("accepts mcp-servers alias and strips comments", () => {
    withTempHome((home) => {
      const proj = join(home, "proj");
      mkdirSync(proj, { recursive: true });
      const p = join(proj, ".mcp.json");
      writeFileSync(p, `{
        // claude-style comment
        "mcp-servers": { "aliased": { "command": "x" /* inline */ } }
      }`);
      const config = loadMcpConfig(proj);
      expect(config.mcpServers["aliased"]?.command).toBe("x");
    });
  });

  it("skips invalid entries with a warning, keeps valid ones", () => {
    withTempHome((home) => {
      const proj = join(home, "proj");
      mkdirSync(proj, { recursive: true });
      writeConfig(proj, ".mcp.json", {
        mcpServers: {
          ok: { command: "npx", args: ["-y", "pkg"] },
          noCommandNoUrl: { args: ["x"] },
          badArgs: { command: "n", args: "not-an-array" },
        },
      });
      const config = loadMcpConfig(proj);
      expect(Object.keys(config.mcpServers)).toEqual(["ok"]);
    });
  });

  it("keeps adapter-specific fields (directTools, includeTools, searchKeywords)", () => {
    withTempHome((home) => {
      const proj = join(home, "proj");
      mkdirSync(proj, { recursive: true });
      writeConfig(proj, ".mcp.json", {
        mcpServers: {
          gh: {
            command: "npx",
            args: ["-y", "server-github"],
            directTools: ["search_repositories"],
            includeTools: ["get_*"],
            searchKeywords: { "*": ["gh"] },
            lifecycle: "eager",
            toolPrefix: "short",
          },
        },
      });
      const entry = loadMcpConfig(proj).mcpServers["gh"];
      expect(entry?.directTools).toEqual(["search_repositories"]);
      expect(entry?.includeTools).toEqual(["get_*"]);
      expect(entry?.searchKeywords).toEqual({ "*": ["gh"] });
      expect(entry?.lifecycle).toBe("eager");
      expect(entry?.toolPrefix).toBe("short");
    });
  });
});

describe("getConfigSources", () => {
  it("lists all five layers with exists flags", () => {
    withTempHome((home) => {
      const proj = join(home, "proj");
      mkdirSync(proj, { recursive: true });
      process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
      try {
        const sources: ConfigSource[] = getConfigSources(proj);
        expect(sources.map((s) => s.id)).toEqual([
          "shared-global",
          "agents-global",
          "agents-nested-global",
          "pi-global",
          "shared-project",
          "pi-project",
        ]);
        expect(sources.every((s) => !s.exists)).toBe(true);
      } finally {
        delete process.env.PI_CODING_AGENT_DIR;
      }
    });
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  buildStatusReport,
  runBrowserCommand,
  setupInstructions,
  type StatusFacts,
} from "./browser-command.js";
import { agentBrowserConfigSummary } from "./config.js";
import {
  INSTALL_BROWSER_COMMAND,
  INSTALL_CLI_COMMAND,
  INSTALL_SKILL_COMMAND,
} from "./env.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalConfig = process.env.AGENT_BROWSER_CONFIG;
const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalConfig === undefined) delete process.env.AGENT_BROWSER_CONFIG;
  else process.env.AGENT_BROWSER_CONFIG = originalConfig;
});

function baseFacts(): StatusFacts {
  return {
    profilePath: "/tmp/pi-browser/profile",
    profileExists: true,
    legacyProfileExists: false,
    configPath: "/tmp/agent-browser/config.json",
    config: {
      ok: true,
      value: {
        profile: "/tmp/pi-browser/profile",
        session: "pi-browser",
        namespace: "pi-browser",
        engine: "chrome",
        headed: false,
        idleTimeout: "10m",
      },
    },
    cli: { state: "ready", version: "0.37.1", raw: "agent-browser 0.37.1" },
    chromeForTestingPath: "/tmp/chrome-for-testing",
    skillPath: "/tmp/skills/agent-browser",
    skillInstalled: true,
    projectConfigPath: "/tmp/project/agent-browser.json",
    projectConfigExists: false,
    sessions: { ok: true, value: ["pi-browser"] },
  };
}

describe("status and setup copy", () => {
  it("leads with the persistent profile, cleanup timeout, CLI and session count", () => {
    const report = buildStatusReport(baseFacts());
    expect(report).toContain("/tmp/pi-browser/profile");
    expect(report).toContain("idle cleanup    10m");
    expect(report).toContain("agent-browser    0.37.1 — ready");
    expect(report).toContain("Managed sessions 1");
    expect(report).not.toContain("playwright-cli");
  });

  it("explains project overrides and preserved legacy data without reusing it", () => {
    const report = buildStatusReport({
      ...baseFacts(),
      legacyProfileExists: true,
      projectConfigExists: true,
    });
    expect(report).toContain("may override the user defaults");
    expect(report).toContain("intentionally not reused or deleted");
  });

  it("prints the exact commands and never the rejected harness spelling", () => {
    const text = setupInstructions("/tmp/pi-agent");
    expect(text).toContain(INSTALL_CLI_COMMAND);
    expect(text).toContain(INSTALL_BROWSER_COMMAND);
    expect(text).toContain(INSTALL_SKILL_COMMAND);
    expect(text).toContain("npx skills add vercel-labs/agent-browser -a pi -y -g");
    expect(text).not.toContain("--harness");
  });
});

describe("/browser command", () => {
  function panelUi(choices: string[]) {
    return {
      select: vi.fn(async () => choices.shift()),
      custom: vi.fn(async (factory: (...args: any[]) => unknown) => {
        factory({}, { fg: (_color: string, value: string) => value }, {}, () => undefined);
      }),
      notify: vi.fn(),
      confirm: vi.fn(async () => true),
      setStatus: vi.fn(),
    };
  }

  it("shows Setup commands without executing any install", async () => {
    const ui = panelUi(["Setup commands", "Close"]);
    const exec = vi.fn();
    const pi = { exec } as unknown as ExtensionAPI;
    const ctx = { hasUI: true, ui } as unknown as ExtensionCommandContext;
    await runBrowserCommand(pi, ctx);
    expect(ui.custom).toHaveBeenCalledTimes(1);
    expect(exec).not.toHaveBeenCalled();
  });

  it("writes the persistent Profile and ten-minute cleanup without running the CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-browser-command-"));
    temporary.push(dir);
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    process.env.AGENT_BROWSER_CONFIG = join(dir, "agent-browser", "config.json");
    const ui = panelUi(["Configure recommended defaults", "Close"]);
    const exec = vi.fn();
    await runBrowserCommand(
      { exec } as unknown as ExtensionAPI,
      { hasUI: true, ui } as unknown as ExtensionCommandContext,
    );

    const config = JSON.parse(readFileSync(process.env.AGENT_BROWSER_CONFIG, "utf8"));
    expect(agentBrowserConfigSummary(config)).toMatchObject({
      session: "pi-browser",
      namespace: "pi-browser",
      engine: "chrome",
      headed: false,
      idleTimeout: "10m",
    });
    expect(config.profile).toContain("agent-browser");
    expect(exec).not.toHaveBeenCalled();
  });

  it("still offers stale-record cleanup when session listing itself fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-browser-command-"));
    temporary.push(dir);
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    process.env.AGENT_BROWSER_CONFIG = join(dir, "agent-browser", "config.json");
    mkdirSync(join(dir, "agent-browser"), { recursive: true });
    writeFileSync(
      process.env.AGENT_BROWSER_CONFIG,
      JSON.stringify({ profile: join(dir, "profile"), session: "pi-browser", namespace: "pi-browser" }),
    );

    const ui = panelUi(["Sessions", "Clean stale process records", "Back", "Close"]);
    let listCalls = 0;
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("--version")) return { stdout: "agent-browser 0.37.1", stderr: "", code: 0 };
      if (args.includes("list")) {
        listCalls += 1;
        return listCalls === 1
          ? { stdout: "", stderr: "stale socket", code: 1 }
          : { stdout: JSON.stringify({ success: true, data: { sessions: [] } }), stderr: "", code: 0 };
      }
      return { stdout: JSON.stringify({ success: true, summary: {} }), stderr: "", code: 0 };
    });
    await runBrowserCommand(
      { exec } as unknown as ExtensionAPI,
      { hasUI: true, ui } as unknown as ExtensionCommandContext,
    );

    expect(exec).toHaveBeenCalledWith(
      "agent-browser",
      expect.arrayContaining(["doctor", "--offline", "--quick"]),
      expect.anything(),
    );
    expect(ui.notify).toHaveBeenCalledWith(
      "Checked daemon state and removed stale pid/socket records.",
      "info",
    );
  });
});

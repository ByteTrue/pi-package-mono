import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { setAgentBrowserCliOverride } from "./cli.js";

beforeEach(() => setAgentBrowserCliOverride({ command: "agent-browser" }));
afterEach(() => setAgentBrowserCliOverride(undefined));
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
    authStatesDir: "/tmp/pi-browser/auth",
    authStatesCount: 2,
    configPath: "/tmp/agent-browser/config.json",
    config: {
      ok: true,
      value: {
        engine: "chrome",
        headed: false,
        idleTimeout: "10m",
      },
    },
    cli: { state: "ready", version: "0.37.1", raw: "agent-browser 0.37.1" },
    browserLabel: "Auto (system default)",
    dashboard: { running: false, port: 4848, url: "http://localhost:4848" },
    skillPath: "/tmp/skills/agent-browser",
    skillInstalled: true,
    projectConfigPath: "/tmp/project/agent-browser.json",
    projectConfigExists: false,
    sessions: { ok: true, value: ["pi-browser"] },
  };
}

describe("status and setup copy", () => {
  it("leads with saved logins, cleanup timeout, CLI and session count", () => {
    const report = buildStatusReport(baseFacts());
    expect(report).toContain("2 saved (/tmp/pi-browser/auth)");
    expect(report).toContain("Browser          Auto (system default)");
    expect(report).toContain("Dashboard        stopped");
    expect(report).toContain("idle cleanup    10m");
    expect(report).toContain("agent-browser    0.37.1 — ready");
    expect(report).toContain("Sessions          1");
    expect(report).not.toContain("playwright-cli");
  });

  it("explains project overrides and legacy profiles without reusing them", () => {
    const report = buildStatusReport({
      ...baseFacts(),
      config: {
        ok: true,
        value: {
          profile: "/tmp/legacy/profile",
          namespace: "pi-browser",
        },
      },
      projectConfigExists: true,
    });
    expect(report).toContain("may override the user defaults");
    expect(report).toContain("legacy — run Configure defaults to clear");
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
      input: vi.fn(async () => undefined as string | undefined),
      setStatus: vi.fn(),
    };
  }

  it("shows Setup commands without executing any install", async () => {
    const ui = panelUi(["Setup commands", "Close"]);
    const exec = vi.fn();
    const pi = { exec } as unknown as ExtensionAPI;
    const ctx = { hasUI: true, ui } as unknown as ExtensionCommandContext;
    await runBrowserCommand(pi, ctx);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("npm install -g agent-browser"), "info");
    expect(exec).not.toHaveBeenCalled();
  });

  it("writes recommended defaults without global profile or session lock", async () => {
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
      engine: "chrome",
      headed: false,
      idleTimeout: "10m",
    });
    expect(config.profile).toBeUndefined();
    expect(config.session).toBeUndefined();
    expect(config.namespace).toBeUndefined();
    expect(existsSync(join(dir, "agent", "pi-browser", "auth"))).toBe(true);
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

  it("closes any single session from the list without name-based tagging", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-browser-command-"));
    temporary.push(dir);
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    process.env.AGENT_BROWSER_CONFIG = join(dir, "agent-browser", "config.json");
    mkdirSync(join(dir, "agent-browser"), { recursive: true });
    writeFileSync(
      process.env.AGENT_BROWSER_CONFIG,
      JSON.stringify({ profile: join(dir, "profile"), namespace: "pi-browser" }),
    );

    const ui = panelUi(["Sessions", "task-a — running — 2 page(s) — pid 42", "Back", "Close"]);
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("--version")) return { stdout: "agent-browser 0.37.1", stderr: "", code: 0 };
      if (args.includes("list")) {
        return { stdout: JSON.stringify({ success: true, data: { sessions: ["task-a"] } }), stderr: "", code: 0 };
      }
      if (args.includes("info")) {
        return {
          stdout: JSON.stringify({
            success: true,
            data: { session: "task-a", active: true, pid: 42, runtime: { pageCount: 2 } },
          }),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: "", code: 0 };
    });
    await runBrowserCommand(
      { exec } as unknown as ExtensionAPI,
      { hasUI: true, ui } as unknown as ExtensionCommandContext,
    );

    const listed = (ui.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string[];
    expect(listed.some((l) => l.includes("[managed]") || l.includes("[foreign]"))).toBe(false);
    const closedCalls = (exec as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[1] as string[]).includes("close") && !(c[1] as string[]).includes("--all"),
    );
    expect(closedCalls[0]?.[1]).toContain("task-a");
    expect(ui.notify).toHaveBeenCalledWith("Closed task-a.", "info");
  });

  it("navigates to Logins menu and views details for an existing login", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-browser-logins-view-"));
    temporary.push(dir);
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    process.env.AGENT_BROWSER_CONFIG = join(dir, "agent-browser", "config.json");
    const authPath = join(dir, "agent", "pi-browser", "auth");
    mkdirSync(authPath, { recursive: true });
    writeFileSync(
      join(authPath, "github.json"),
      JSON.stringify({
        cookies: [{ name: "token", domain: "github.com" }],
        origins: [{ origin: "https://github.com", localStorage: [] }],
      }),
    );

    const ui = panelUi(["Logins", "github — github.com — 1 cookie(s) — 0.1 KB", "View details", "Back", "Back", "Close"]);
    const exec = vi.fn(async () => ({ stdout: "agent-browser 0.37.1", stderr: "", code: 0 }));

    await runBrowserCommand(
      { exec } as unknown as ExtensionAPI,
      { hasUI: true, ui } as unknown as ExtensionCommandContext,
    );

    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("github.com"), "info");
  });

  it("allows adding a new login through headed sign-in", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-browser-logins-add-"));
    temporary.push(dir);
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    process.env.AGENT_BROWSER_CONFIG = join(dir, "agent-browser", "config.json");

    const ui = panelUi(["Logins", "+ Add new login", "Back", "Close"]);
    ui.input = vi.fn(async () => "v2ex");
    ui.confirm = vi.fn(async () => true);

    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("--version")) return { stdout: "agent-browser 0.37.1", stderr: "", code: 0 };
      if (args.includes("save")) {
        const target = args[args.length - 1]!;
        writeFileSync(target, JSON.stringify({ cookies: [{ name: "v2", domain: "v2ex.com" }] }));
      }
      return { stdout: "ok", stderr: "", code: 0 };
    });

    await runBrowserCommand(
      { exec } as unknown as ExtensionAPI,
      { hasUI: true, ui } as unknown as ExtensionCommandContext,
    );

    const targetFile = join(dir, "agent", "pi-browser", "auth", "v2ex.json");
    expect(existsSync(targetFile)).toBe(true);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining('Saved login "v2ex"'), "info");
  });

  it("allows renaming and deleting a saved login", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-browser-logins-crud-"));
    temporary.push(dir);
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    process.env.AGENT_BROWSER_CONFIG = join(dir, "agent-browser", "config.json");
    const authPath = join(dir, "agent", "pi-browser", "auth");
    mkdirSync(authPath, { recursive: true });
    writeFileSync(join(authPath, "old-login.json"), JSON.stringify({ cookies: [] }));

    // 1. Rename old-login -> new-login
    const ui = panelUi(["Logins", "old-login — 0.0 KB", "Rename", "Close"]);
    ui.input = vi.fn(async () => "new-login");

    const exec = vi.fn(async () => ({ stdout: "agent-browser 0.37.1", stderr: "", code: 0 }));

    await runBrowserCommand(
      { exec } as unknown as ExtensionAPI,
      { hasUI: true, ui } as unknown as ExtensionCommandContext,
    );

    expect(existsSync(join(authPath, "new-login.json"))).toBe(true);
    expect(existsSync(join(authPath, "old-login.json"))).toBe(false);

    // 2. Delete new-login
    const deleteUi = panelUi(["Logins", "new-login — 0.0 KB", "Delete", "Close"]);
    deleteUi.confirm = vi.fn(async () => true);

    await runBrowserCommand(
      { exec } as unknown as ExtensionAPI,
      { hasUI: true, ui: deleteUi } as unknown as ExtensionCommandContext,
    );

    expect(existsSync(join(authPath, "new-login.json"))).toBe(false);
  });

  it("navigates to Dashboard menu and starts the dashboard", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-browser-dash-ui-"));
    temporary.push(dir);
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    process.env.AGENT_BROWSER_CONFIG = join(dir, "agent-browser", "config.json");

    const ui = panelUi(["Dashboard", "Start dashboard", "Close"]);
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("--version")) return { stdout: "agent-browser 0.37.1", stderr: "", code: 0 };
      return { stdout: "Dashboard started at http://localhost:4848", stderr: "", code: 0 };
    });

    await runBrowserCommand(
      { exec } as unknown as ExtensionAPI,
      { hasUI: true, ui } as unknown as ExtensionCommandContext,
    );

    const dashCalls = (exec as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      (c[1] as string[]).includes("dashboard"),
    );
    expect(dashCalls.length).toBeGreaterThan(0);
    expect(dashCalls[0]?.[1]).toContain("start");
  });

  it("allows selecting a browser executable from Settings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-browser-settings-browser-"));
    temporary.push(dir);
    process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
    process.env.AGENT_BROWSER_CONFIG = join(dir, "agent-browser", "config.json");
    mkdirSync(join(dir, "agent-browser"), { recursive: true });
    writeFileSync(process.env.AGENT_BROWSER_CONFIG, JSON.stringify({ engine: "chrome" }));

    // Fake custom browser executable
    const customBin = join(dir, "my-custom-browser.exe");
    writeFileSync(customBin, "");

    const ui = panelUi([
      "Settings",
      "Browser: Auto (system default)",
      "Custom executable path...",
      "Close",
    ]);
    ui.input = vi.fn(async () => customBin);

    await runBrowserCommand(
      { exec: vi.fn() } as unknown as ExtensionAPI,
      { hasUI: true, ui } as unknown as ExtensionCommandContext,
    );

    const saved = JSON.parse(readFileSync(process.env.AGENT_BROWSER_CONFIG, "utf8"));
    expect(saved.executablePath).toBe(customBin);
  });
});

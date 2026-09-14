import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync as fsSymlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildStatusReport, runBrowserCommand, type StatusFacts } from "./browser-command.js";
import { mergePlaywrightConfig, type ManagedBrowserConfig } from "./config.js";
import { INSTALL_CLI } from "./env.js";
import { profileDir } from "./paths.js";
import { SOURCE_BROWSERS } from "./import/detect.js";

const saved = {
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  PLAYWRIGHT_MCP_CONFIG: process.env.PLAYWRIGHT_MCP_CONFIG,
  HOME: process.env.HOME,
};
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-browser-command-"));
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  process.env.PLAYWRIGHT_MCP_CONFIG = join(dir, "cli.config.json");
  process.env.HOME = join(dir, "home");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = saved.PI_CODING_AGENT_DIR;
  if (saved.PLAYWRIGHT_MCP_CONFIG === undefined) delete process.env.PLAYWRIGHT_MCP_CONFIG;
  else process.env.PLAYWRIGHT_MCP_CONFIG = saved.PLAYWRIGHT_MCP_CONFIG;
  if (saved.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = saved.HOME;
});

function makeContext(selectImpl: (title: string, options: string[]) => string | undefined, confirm = true) {
  const ui = {
    select: vi.fn(async (title: string, options: string[]) => selectImpl(title, options)),
    confirm: vi.fn(async (_title: string, _message: string) => confirm),
    notify: vi.fn((_message: string, _level?: string) => undefined),
    editor: vi.fn(async (_title: string, _text: string) => undefined as string | undefined),
    custom: vi.fn(async (_factory: unknown) => undefined as unknown),
    input: vi.fn(async (_title: string, _placeholder?: string) => "" as string | undefined),
    setStatus: vi.fn((_key: string, _value?: string) => undefined),
  };
  const ctx = { hasUI: true, ui } as unknown as ExtensionCommandContext;
  return { ctx, ui };
}

type ExecImpl = (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>;

function makePi(stdout = "0.1.19\n", code = 0, impl?: ExecImpl) {
  const exec = vi.fn(impl ?? (async () => ({ stdout, stderr: "", code, killed: false })));
  const registerCommand = vi.fn();
  const pi = { exec, registerCommand } as unknown as ExtensionAPI;
  return { pi, exec, registerCommand };
}

const MANUAL = "Manual sign-in (opens a window)";

/**
 * A fake user-data-dir for `id` under this test's temp HOME, using the platform root the
 * detector actually looks for — hardcoding a macOS path would make the browser invisible
 * to detection on a Linux runner.
 */
function browserRoot(id: string): string {
  const def = SOURCE_BROWSERS.find((entry) => entry.id === id);
  if (!def) throw new Error("unknown browser id " + id);
  const root = def.roots[process.platform];
  if (!root) return join(dir, "home", "no-browser-for-this-platform", id);
  return join(dir, "home", root.slice(2));
}

const managed: ManagedBrowserConfig = {
  channel: "msedge",
  userDataDir: "/tmp/agent/pi-browser/profiles/default",
  headless: true,
  outputDir: "/tmp/agent/pi-browser/artifacts",
};

describe("buildStatusReport", () => {
  it("shows profile, CLI, skill and config state", () => {
    const merged = mergePlaywrightConfig(undefined, managed);
    if (!merged.ok) throw new Error("merge failed");
    const facts: StatusFacts = {
      profilePath: managed.userDataDir,
      profileExists: false,
      configPath: "/tmp/cli.config.json",
      config: { ok: true, value: merged.value },
      cli: { state: "ready", version: "0.1.19", raw: "0.1.19" },
      skillInstalled: false,
      skillPath: "/tmp/skills/playwright-cli",
      artifactsPath: "/tmp/agent/pi-browser/artifacts",
      target: {
        id: "copy",
        kind: "copy",
        channel: "msedge",
        browserLabel: "Copy profile",
        userDataDir: managed.userDataDir,
        profileDirectory: "Default",
        label: "Copy profile (no data yet)",
      },
    };
    const report = buildStatusReport(facts);
    expect(report).toContain("Copy profile (no data yet)");
    expect(report).toContain("copy, owned by pi-browser");
    expect(report).toContain("no data yet");
    expect(report).toMatch(/channel\s+msedge/);
    expect(report).toContain("mock keychain disabled: yes");
    expect(report).toContain("playwright-cli 0.1.19");
    expect(report).toContain("missing");
    expect(report).toContain("run Setup to install it");
  });

  it("flags a config pointing at another profile", () => {
    const merged = mergePlaywrightConfig(undefined, { ...managed, userDataDir: "/somewhere/else", profileDirectory: "Profile 1" });
    if (!merged.ok) throw new Error("merge failed");
    const report = buildStatusReport({
      profilePath: managed.userDataDir,
      profileExists: true,
      configPath: "/tmp/cli.config.json",
      config: { ok: true, value: merged.value },
      cli: { state: "outdated", version: "0.1.2", raw: "0.1.2" },
      skillInstalled: true,
      skillPath: "/tmp/skills/playwright-cli",
      artifactsPath: "/tmp/agent/pi-browser/artifacts",
      target: {
        id: "chrome:Profile 1",
        kind: "real",
        channel: "chrome",
        browserLabel: "Google Chrome",
        userDataDir: "/somewhere/else",
        profileDirectory: "Profile 1",
        label: "Google Chrome · Work",
      },
      targetLockedBy: "Google Chrome (pid 4242)",
    });
    // Driving a real profile must be impossible to mistake for the safe copy.
    expect(report).toContain("YOUR REAL PROFILE");
    expect(report).toContain("the agent drives your daily browser as you");
    expect(report).toContain("locked by: Google Chrome (pid 4242)");
    expect(report).toContain("profile      Profile 1");
    expect(report).toContain("needs >= 0.1.19");
  });
});

describe("/browser command", () => {
  it("registers the command and opens status in a read-only panel, then closes", async () => {
    const { pi, registerCommand } = makePi();
    const { ctx, ui } = makeContext((_title, options) => (options.includes("Close") ? "Close" : undefined));
    const choices = ["Status", "Close"];
    const panels: unknown[] = [];
    ui.custom.mockImplementation(async (factory: unknown) => {
      panels.push(factory);
      return undefined;
    });
    ui.select.mockImplementation(async (_title: string, options: string[]) => choices.shift() ?? options[options.length - 1]);
    await runBrowserCommand(pi, ctx);
    expect(panels.length).toBe(1);
    const component = (panels[0] as Function)(
      {},
      { fg: (_color: string, str: string) => str },
      {},
      () => undefined,
    ) as { render(width: number): string[] };
    const rendered = component.render(80).join("\n");
    expect(rendered).toContain("Target");
    expect(rendered).toContain("─"); // bordered, so it reads apart from the chat background
    expect(ui.editor).not.toHaveBeenCalled();
    expect(registerCommand).not.toHaveBeenCalled();
  });

  it("runs the install command after confirmation", async () => {
    const { pi, exec } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    const browserChoices = ["Setup", "Close"];
    const setupChoices = [INSTALL_CLI.label, "Back"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return browserChoices.shift() ?? "Close";
      if (title.startsWith("Setup")) return setupChoices.shift() ?? "Back";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);
    expect(ui.confirm).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("npm", ["install", "-g", "@playwright/cli@latest"], expect.anything());
    expect(ui.notify).toHaveBeenCalledWith("0.1.19", "info");
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("shows install output only when the command fails", async () => {
    const { pi } = makePi("boom\n", 1);
    const { ctx, ui } = makeContext(() => undefined);
    const browserChoices = ["Setup", "Close"];
    const setupChoices = [INSTALL_CLI.label, "Back"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return browserChoices.shift() ?? "Close";
      if (title.startsWith("Setup")) return setupChoices.shift() ?? "Back";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("failed with exit code 1"), "error");
    expect(ui.custom).toHaveBeenCalledTimes(1);
  });

  it("reports when no source browser is installed", async () => {
    const { pi } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    const choices = ["Data", "Import login data", "Close"];
    ui.select.mockImplementation(async () => choices.shift() ?? "Close");
    await runBrowserCommand(pi, ctx);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("No supported browsers found"), "warning");
  });

  it("clears the imported profile after confirmation", async () => {
    const { pi } = makePi();
    mkdirSync(profileDir(), { recursive: true });
    const { ctx, ui } = makeContext(() => undefined);
    const choices = ["Data", "Clear imported data", "Close"];
    ui.select.mockImplementation(async () => choices.shift() ?? "Close");
    await runBrowserCommand(pi, ctx);
    expect(existsSync(profileDir())).toBe(false);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Cleared"), "info");
  });

  it("reports when no cli sessions are open", async () => {
    const { pi } = makePi("", 0, async (_command: string, args: string[]) => ({
      stdout: args[0] === "list" ? JSON.stringify({ browsers: [] }) : "",
      stderr: "",
      code: 0,
      killed: false,
    }));
    const { ctx, ui } = makeContext(() => undefined);
    const choices = ["Sessions", "Close"];
    ui.select.mockImplementation(async () => choices.shift() ?? "Close");
    await runBrowserCommand(pi, ctx);
    expect(ui.notify).toHaveBeenCalledWith("No open playwright-cli sessions.", "info");
  });

  it("warns about sessions owned by other workspaces", async () => {
    const { pi } = makePi("", 0, async (_command: string, args: string[]) => {
      const payload = args.includes("--all")
        ? { browsers: [{ name: "theirs", status: "open", workspace: "w2" }] }
        : { browsers: [] };
      return { stdout: args[0] === "list" ? JSON.stringify(payload) : "", stderr: "", code: 0, killed: false };
    });
    const { ctx, ui } = makeContext(() => undefined);
    const browserChoices = ["Sessions", "Close"];
    const sessionChoices = ["theirs — open — other workspace", "Back"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return browserChoices.shift() ?? "Close";
      if (title.startsWith("playwright-cli sessions")) return sessionChoices.shift() ?? "Back";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("another workspace"), "warning");
  });

  it("closes all sessions from the sessions menu", async () => {
    const calls: string[][] = [];
    const { pi } = makePi("", 0, async (_command: string, args: string[]) => {
      calls.push(args);
      const payload = args.includes("--all")
        ? { browsers: [{ name: "demo", status: "open", browserType: "msedge", workspace: "w1" }] }
        : { browsers: [{ name: "demo", status: "open", browserType: "msedge", workspace: "w1" }] };
      return {
        stdout: args[0] === "list" ? JSON.stringify(payload) : "closed everything",
        stderr: "",
        code: 0,
        killed: false,
      };
    });
    const { ctx, ui } = makeContext(() => undefined);
    const browserChoices = ["Sessions", "Close"];
    const sessionChoices = ["Close all sessions", "Back"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return browserChoices.shift() ?? "Close";
      if (title.startsWith("playwright-cli sessions")) return sessionChoices.shift() ?? (options[options.length - 1] ?? "Back");
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);
    expect(calls).toContainEqual(["close-all"]);
    expect(ui.notify).toHaveBeenCalledWith("closed everything", "info");
  });

  it("does nothing without a UI", async () => {
    const { pi } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    (ctx as { hasUI: boolean }).hasUI = false;
    await runBrowserCommand(pi, ctx);
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("toggles headless off from Settings", async () => {
    const { pi } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    const configPath = join(dir, "cli.config.json");
    const merged = mergePlaywrightConfig(undefined, { ...managed, userDataDir: profileDir() });
    if (!merged.ok) throw new Error("merge failed");
    writeFileSync(configPath, JSON.stringify(merged.value));

    const top = ["Settings", "Close"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return top.shift() ?? "Close";
      if (title.startsWith("Settings — ")) return "Open headed (visible window)";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    expect(saved.browser.launchOptions.headless).toBe(false);
    expect(saved.browser.launchOptions.channel).toBe("msedge");
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Headless off"), "info");
  });

  it("points Settings at Import when there is no config yet", async () => {
    const { pi } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    const top = ["Settings", "Close"];
    ui.select.mockImplementation(async (title: string, _options: string[]) => {
      if (title === "Browser") return top.shift() ?? "Close";
      return "Back";
    });
    await runBrowserCommand(pi, ctx);

    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("No CLI config yet"), "warning");
    expect(ui.select).toHaveBeenCalledTimes(2);
  });

  it("keeps a headed choice across a re-import", async () => {
    const edgeRoot = browserRoot("msedge");
    mkdirSync(join(edgeRoot, "Default"), { recursive: true });
    writeFileSync(join(edgeRoot, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Personal" } } } }));
    writeFileSync(join(edgeRoot, "Default", "Cookies"), "cookie-db");

    const configPath = join(dir, "cli.config.json");
    const headed = mergePlaywrightConfig(undefined, { ...managed, userDataDir: profileDir(), headless: false });
    if (!headed.ok) throw new Error("merge failed");
    writeFileSync(configPath, JSON.stringify(headed.value));

    const { pi } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    const top = ["Data", "Import login data", "Close"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return top.shift() ?? "Close";
      if (title.startsWith("Import login data — source")) return "Microsoft Edge";
      if (title.startsWith("Profile — ")) return "Personal  (Default)";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    expect(saved.browser.launchOptions.headless).toBe(false);
    expect(saved.browser.launchOptions.channel).toBe("msedge");
    expect(saved.browser.userDataDir).toBe(profileDir());
  });

  it("opens a sign-in window and closes it to free the profile when the user is done", async () => {
    const configPath = join(dir, "cli.config.json");
    const existing = mergePlaywrightConfig(undefined, { ...managed, userDataDir: profileDir() });
    if (!existing.ok) throw new Error("merge failed");
    writeFileSync(configPath, JSON.stringify(existing.value));
    mkdirSync(profileDir(), { recursive: true });

    const { pi, exec } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    const top = ["Data"];
    const login = [MANUAL, "Back"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return top.shift() ?? "Close";
      if (title.startsWith("Data — ")) return login.shift() ?? "Back";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);

    // Opens headed, waits on the blocking prompt, then always closes the session.
    const openCall = (exec.mock.calls as unknown as [string, string[]][]).find(([, a]) => a.includes("open"));
    expect(openCall).toBeDefined();
    const args = openCall?.[1] ?? [];
    expect(args[0]).toBe("-s=pi-browser-login");
    expect(args.some((a) => a.startsWith("--config=") && a.endsWith("sign-in.config.json"))).toBe(true);
    expect(args).toContain("--headed");
    // The live config must not be handed to the sign-in window: it may point at a real profile.
    expect(args.some((a) => a === "--config=" + join(dir, "cli.config.json"))).toBe(false);
    expect(ui.input).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("playwright-cli", ["-s=pi-browser-login", "close"], expect.anything());
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("profile is free"), "info");
  });

  it("warns instead of claiming success when the sign-in window cannot be closed", async () => {
    const configPath = join(dir, "cli.config.json");
    const existing = mergePlaywrightConfig(undefined, { ...managed, userDataDir: profileDir() });
    if (!existing.ok) throw new Error("merge failed");
    writeFileSync(configPath, JSON.stringify(existing.value));
    mkdirSync(profileDir(), { recursive: true });

    const { pi, exec } = makePi("0.1.19\n", 0, async (command, args) => {
      if (args.includes("close")) return { stdout: "", stderr: "close failed", code: 1, killed: false };
      return { stdout: command, stderr: "", code: 0, killed: false };
    });
    const { ctx, ui } = makeContext(() => undefined);
    const top = ["Data"];
    const login = [MANUAL, "Back"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return top.shift() ?? "Close";
      if (title.startsWith("Data — ")) return login.shift() ?? "Back";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);

    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Sessions"), "warning");
    expect(ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("profile is free"), "info");
  });

  it("refuses a sign-in window before the first import", async () => {
    const { pi, exec } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    const top = ["Data"];
    const login = [MANUAL, "Back"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return top.shift() ?? "Close";
      if (title.startsWith("Data — ")) return login.shift() ?? "Back";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);

    expect(exec).not.toHaveBeenCalledWith("playwright-cli", expect.anything(), expect.anything());
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Import login data first"), "warning");
  });

  it("switches the target to a real profile only after informed consent, writing nothing", async () => {
    const chromeRoot = browserRoot("chrome");
    mkdirSync(join(chromeRoot, "Default"), { recursive: true });
    writeFileSync(join(chromeRoot, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Main" } } } }));
    writeFileSync(join(chromeRoot, "Default", "Cookies"), "cookie-db");
    const edgeRoot = browserRoot("msedge");
    mkdirSync(join(edgeRoot, "Default"), { recursive: true });
    writeFileSync(join(edgeRoot, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Personal" } } } }));
    writeFileSync(join(edgeRoot, "Default", "Cookies"), "cookie-db");

    const configPath = join(dir, "cli.config.json");
    const existing = mergePlaywrightConfig(undefined, { ...managed, userDataDir: profileDir() });
    if (!existing.ok) throw new Error("merge failed");
    writeFileSync(configPath, JSON.stringify(existing.value));
    const before = readFileSync(configPath, "utf8");

    const { pi, exec } = makePi();
    const { ctx, ui } = makeContext(() => undefined, true /* consent granted */);
    const top = ["Target: Copy profile (no data yet)", "Close"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return top.shift() ?? "Close";
      if (title.startsWith("Target — ")) return "Google Chrome · Main";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);

    // The picker lists the copy first and every detected real profile, labelled with current.
    expect(ui.select).toHaveBeenCalledWith(
      expect.stringContaining("Target — "),
      expect.arrayContaining(["Copy profile (no data yet)  — current", "Google Chrome · Main", "Microsoft Edge · Personal", "Back"]),
    );
    // Choosing a real profile is a consented, config-only operation.
    expect(ui.confirm).toHaveBeenCalledTimes(1);
    expect(String(ui.confirm.mock.calls[0]?.[1])).toContain("acts as you");
    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    expect(saved.browser.launchOptions.channel).toBe("chrome");
    expect(saved.browser.userDataDir).toBe(chromeRoot);
    // Selecting must not launch a browser or copy data anywhere.
    expect(exec).not.toHaveBeenCalledWith("playwright-cli", expect.anything(), expect.anything());
    expect(before).not.toBe(readFileSync(configPath, "utf8"));
  });

  it("refuses to point at a real profile while that browser is running", async () => {
    const chromeRoot = browserRoot("chrome");
    mkdirSync(join(chromeRoot, "Default"), { recursive: true });
    writeFileSync(join(chromeRoot, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Main" } } } }));
    // A lock whose pid is alive blocks the switch; the copy stays untouched.
    const holder = String(process.pid); // our own pid is guaranteed alive
    try { fsSymlinkSync(chromeRoot + "-fake-" + holder, join(chromeRoot, "SingletonLock")); } catch {}

    const configPath = join(dir, "cli.config.json");
    const existing = mergePlaywrightConfig(undefined, { ...managed, userDataDir: profileDir() });
    if (!existing.ok) throw new Error("merge failed");
    writeFileSync(configPath, JSON.stringify(existing.value));
    const before = readFileSync(configPath, "utf8");

    const { pi } = makePi();
    const { ctx, ui } = makeContext(() => undefined, true);
    const top = ["Target: Copy profile (no data yet)", "Close"];
    ui.select.mockImplementation(async (title: string, options: string[]) => {
      if (title === "Browser") return top.shift() ?? "Close";
      if (title.startsWith("Target — ")) return "Google Chrome · Main";
      return options[options.length - 1];
    });
    await runBrowserCommand(pi, ctx);

    expect(ui.confirm).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("is running"), "warning");
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });
});

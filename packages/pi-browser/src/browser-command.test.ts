import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildStatusReport, runBrowserCommand, type StatusFacts } from "./browser-command.js";
import { mergePlaywrightConfig, type ManagedBrowserConfig } from "./config.js";
import { INSTALL_CLI } from "./env.js";
import { profileDir } from "./paths.js";

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
    };
    const report = buildStatusReport(facts);
    expect(report).toContain("not imported yet");
    expect(report).toMatch(/channel\s+msedge/);
    expect(report).toContain("(matches our profile)");
    expect(report).toContain("mock keychain disabled: yes");
    expect(report).toContain("playwright-cli 0.1.19");
    expect(report).toContain("missing");
    expect(report).toContain("run Setup to install it");
  });

  it("flags a config pointing at another profile", () => {
    const merged = mergePlaywrightConfig(undefined, { ...managed, userDataDir: "/somewhere/else" });
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
    });
    expect(report).toContain("(does not match our profile)");
    expect(report).toContain("needs >= 0.1.19");
  });
});

describe("/browser command", () => {
  it("registers the command and opens status, then closes", async () => {
    const { pi, registerCommand } = makePi();
    const { ctx, ui } = makeContext((_title, options) => (options.includes("Close") ? "Close" : undefined));
    const choices = ["Status", "Close"];
    ui.select.mockImplementation(async (_title: string, options: string[]) => choices.shift() ?? options[options.length - 1]);
    await runBrowserCommand(pi, ctx);
    expect(ui.editor).toHaveBeenCalledTimes(1);
    expect(String(ui.editor.mock.calls[0]?.[1])).toContain("Profile");
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
    expect(ui.editor).not.toHaveBeenCalled();
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
    expect(ui.editor).toHaveBeenCalledTimes(1);
    expect(String(ui.editor.mock.calls[0]?.[0])).toContain("read only");
  });

  it("reports when no source browser is installed", async () => {
    const { pi } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    const choices = ["Import login data", "Close"];
    ui.select.mockImplementation(async () => choices.shift() ?? "Close");
    await runBrowserCommand(pi, ctx);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("No supported browsers found"), "warning");
  });

  it("clears the imported profile after confirmation", async () => {
    const { pi } = makePi();
    mkdirSync(profileDir(), { recursive: true });
    const { ctx, ui } = makeContext(() => undefined);
    const choices = ["Clear imported data", "Close"];
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
    const edgeRoot = join(dir, "home", "Library/Application Support/Microsoft Edge");
    mkdirSync(join(edgeRoot, "Default"), { recursive: true });
    writeFileSync(join(edgeRoot, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Personal" } } } }));
    writeFileSync(join(edgeRoot, "Default", "Cookies"), "cookie-db");

    const configPath = join(dir, "cli.config.json");
    const headed = mergePlaywrightConfig(undefined, { ...managed, userDataDir: profileDir(), headless: false });
    if (!headed.ok) throw new Error("merge failed");
    writeFileSync(configPath, JSON.stringify(headed.value));

    const { pi } = makePi();
    const { ctx, ui } = makeContext(() => undefined);
    const top = ["Import login data", "Close"];
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
});

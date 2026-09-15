import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  INSTALL_SKILL_COMMAND,
  MIN_AGENT_BROWSER_VERSION,
  installedAgentBrowserSkillDir,
  isVersionAtLeast,
  parseVersion,
  probeAgentBrowser,
  type ExecFn,
} from "./env.js";
import { agentBrowserCandidates, agentBrowserNativeExeName, resolveAgentBrowserCommand } from "./cli.js";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const fakeHome = mkdtempSync(join(tmpdir(), "pi-browser-home-"));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome };
});

describe("agent-browser environment", () => {
  it("uses the confirmed Pi skill command", () => {
    expect(INSTALL_SKILL_COMMAND).toBe("npx skills add vercel-labs/agent-browser -a pi -y -g");
  });

  it("parses and compares versions numerically", () => {
    expect(parseVersion("agent-browser 0.37.1")).toBe("0.37.1");
    expect(parseVersion("none")).toBeUndefined();
    expect(isVersionAtLeast("0.37.1", MIN_AGENT_BROWSER_VERSION)).toBe(true);
    expect(isVersionAtLeast("0.37.0", MIN_AGENT_BROWSER_VERSION)).toBe(false);
    expect(isVersionAtLeast("1.0.0", MIN_AGENT_BROWSER_VERSION)).toBe(true);
  });

  it("reports ready, outdated and missing CLI states", async () => {
    const result = (stdout: string, code: number | null = 0): ExecFn => async () => ({
      stdout,
      stderr: "",
      code,
    });
    await expect(probeAgentBrowser(result("agent-browser 0.37.1"))).resolves.toMatchObject({ state: "ready" });
    await expect(probeAgentBrowser(result("agent-browser 0.36.0"))).resolves.toMatchObject({ state: "outdated" });
    await expect(probeAgentBrowser(result("not found", 127))).resolves.toMatchObject({ state: "missing" });
    const throwing: ExecFn = async () => {
      throw new Error("spawn ENOENT");
    };
    await expect(probeAgentBrowser(throwing)).resolves.toMatchObject({ state: "missing" });
  });

  it("finds the first candidate containing SKILL.md", () => {
    expect(installedAgentBrowserSkillDir(["/definitely/missing/a", "/definitely/missing/b"])).toBeUndefined();
  });

  it("resolves the agent-browser CLI from seeded env locations", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "pi-browser-cli-"));
    // APPDATA=fixture makes the npm global root fixture\npm.
    const binDir = join(fixture, "npm", "node_modules", "agent-browser", "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "agent-browser.js"), "#!/usr/bin/env node\n");
    const savedPath = process.env.PATH;
    const savedAppData = process.env.APPDATA;
    const savedPrefix = process.env.NODE_PREFIX;
    try {
      process.env.PATH = fixture; // empty dir: nothing spawnable on PATH
      delete process.env.APPDATA;
      delete process.env.NODE_PREFIX;
      // The fixture only ships a JS entry, so the resolver must wrap it with node.
      process.env.APPDATA = fixture;
      const resolved = resolveAgentBrowserCommand();
      expect(resolved.command).toBe(process.execPath);
      expect(resolved.args?.[0]).toBe(join(binDir, "agent-browser.js"));

      // A native binary in the package wins over the JS entry.
      const nativeName = agentBrowserNativeExeName();
      writeFileSync(join(binDir, nativeName), "");
      const nativeResolved = resolveAgentBrowserCommand();
      expect(nativeResolved.command).toBe(join(binDir, nativeName));
      expect(nativeResolved.args).toBeUndefined();
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
      if (savedAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = savedAppData;
      if (savedPrefix === undefined) delete process.env.NODE_PREFIX;
      else process.env.NODE_PREFIX = savedPrefix;
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("probes the real CLI through a shell:false spawn like pi.exec", async () => {
    // Regression for the released 0.3.0 Status bug: pi.exec cannot launch the
    // npm .cmd shim on Windows, so the probe must use the resolved native
    // binary. Only meaningful where the npm-global native binary exists.
    const appdata = process.env.APPDATA;
    const native = appdata
      ? join(appdata, "npm", "node_modules", "agent-browser", "bin", agentBrowserNativeExeName())
      : undefined;
    if (!native || !existsSync(native)) return;
    const realExec: ExecFn = (command, args, options) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        const timer = options?.timeout
          ? setTimeout(() => {
              child.kill("SIGKILL");
            }, options.timeout)
          : undefined;
        child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
        child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
        child.once("error", reject);
        child.once("close", (code) => {
          if (timer) clearTimeout(timer);
          resolve({ stdout, stderr, code });
        });
      });
    const probe = await probeAgentBrowser(realExec);
    expect(probe.state).toBe("ready");
    if (probe.state === "ready") expect(probe.version).toBe(MIN_AGENT_BROWSER_VERSION);
  });

  it("never resolves the extensionless sh shim on Windows", () => {
    if (process.platform !== "win32") return;
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = "C:\\definitely-missing-pi-browser-dir";
      const bare = agentBrowserCandidates().some((c) => !c.args && c.command.endsWith("\\agent-browser"));
      expect(bare).toBe(false);
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
  });

  it("reports missing with the install hint when nothing exists", async () => {
    const savedPath = process.env.PATH;
    const savedAppData = process.env.APPDATA;
    const savedPrefix = process.env.NODE_PREFIX;
    try {
      process.env.PATH = "C:\\definitely-missing-pi-browser-dir";
      delete process.env.APPDATA;
      delete process.env.NODE_PREFIX;
      const probe = await probeAgentBrowser(async () => ({ stdout: "", stderr: "", code: 0 }));
      expect(probe.state).toBe("missing");
      if (probe.state === "missing") expect(probe.detail).toContain("npm install -g agent-browser");
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
      if (savedAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = savedAppData;
      if (savedPrefix === undefined) delete process.env.NODE_PREFIX;
      else process.env.NODE_PREFIX = savedPrefix;
    }
  });
});

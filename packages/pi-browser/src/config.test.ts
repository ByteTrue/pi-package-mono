import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_IDLE_TIMEOUT,
  agentBrowserConfigSummary,
  mergeAgentBrowserConfig,
  readAgentBrowserConfig,
  setHeaded,
  setIdleTimeout,
  writeAgentBrowserConfig,
  type ManagedAgentBrowserConfig,
} from "./config.js";

let dir: string;
const managed: ManagedAgentBrowserConfig = {
  profile: "/tmp/pi-profile",
  screenshotDir: "/tmp/artifacts",
  headed: false,
  idleTimeout: DEFAULT_IDLE_TIMEOUT,
  executablePath: "/tmp/chrome-for-testing",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-browser-config-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const configPath = (): string => join(dir, "config.json");

describe("agent-browser config", () => {
  it("writes namespace and explicit idle cleanup without global profile or session lock", () => {
    const value = mergeAgentBrowserConfig(undefined, managed);
    expect(value).toMatchObject({
      engine: "chrome",
      headed: false,
      idleTimeout: "10m",
      screenshotDir: "/tmp/artifacts",
      executablePath: "/tmp/chrome-for-testing",
    });
    expect(value.profile).toBeUndefined();
    expect(value.session).toBeUndefined();
    expect(value.namespace).toBeUndefined();
  });

  it("preserves settings it does not manage", () => {
    const value = mergeAgentBrowserConfig(
      { proxy: "http://localhost:8080", maxOutput: 20_000, plugins: [{ name: "x" }] },
      managed,
    );
    expect(value.proxy).toBe("http://localhost:8080");
    expect(value.maxOutput).toBe(20_000);
    expect(value.plugins).toEqual([{ name: "x" }]);
  });

  it("keeps an existing executable when Chrome for Testing has not been discovered", () => {
    const { executablePath: _ignored, ...withoutExecutable } = managed;
    const value = mergeAgentBrowserConfig({ executablePath: "/custom/chrome" }, withoutExecutable);
    expect(value.executablePath).toBe("/custom/chrome");
  });

  it("changes window mode and timeout without dropping other keys", () => {
    const original = mergeAgentBrowserConfig({ proxy: "http://proxy" }, managed);
    expect(setHeaded(original, true)).toMatchObject({ headed: true, proxy: "http://proxy" });
    expect(setIdleTimeout(original, "30m")).toMatchObject({ idleTimeout: "30m", proxy: "http://proxy" });
  });

  it("summarises only valid supported shapes", () => {
    expect(agentBrowserConfigSummary(mergeAgentBrowserConfig(undefined, managed))).toEqual({
      engine: "chrome",
      headed: false,
      idleTimeout: "10m",
      screenshotDir: "/tmp/artifacts",
      executablePath: "/tmp/chrome-for-testing",
    });
    expect(agentBrowserConfigSummary({ headed: "yes", idleTimeout: false })).toEqual({});
  });
});

describe("config file safety", () => {
  it("returns undefined for a missing file and refuses invalid JSON", () => {
    expect(readAgentBrowserConfig(configPath())).toEqual({ ok: true, value: undefined });
    writeFileSync(configPath(), "{ no");
    expect(readAgentBrowserConfig(configPath()).ok).toBe(false);
    writeFileSync(configPath(), "[]");
    expect(readAgentBrowserConfig(configPath()).ok).toBe(false);
  });

  it("writes atomically with restricted permissions and backs up changes", () => {
    const value = mergeAgentBrowserConfig(undefined, managed);
    expect(writeAgentBrowserConfig(configPath(), value)).toMatchObject({ ok: true, changed: true });
    if (process.platform !== "win32") expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(writeAgentBrowserConfig(configPath(), value)).toMatchObject({ ok: true, changed: false });

    const before = readFileSync(configPath(), "utf8");
    const changed = setHeaded(value, true);
    const result = writeAgentBrowserConfig(configPath(), changed);
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.backupPath) throw new Error("expected backup");
    expect(readFileSync(result.backupPath, "utf8")).toBe(before);
    expect(JSON.parse(readFileSync(configPath(), "utf8")).headed).toBe(true);
  });
});

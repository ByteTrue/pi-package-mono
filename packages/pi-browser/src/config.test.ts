import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MOCK_KEYCHAIN_FLAG,
  managedBrowserSummary,
  mergePlaywrightConfig,
  readPlaywrightConfig,
  setHeadless,
  writePlaywrightConfig,
  type ManagedBrowserConfig,
} from "./config.js";

let dir: string;
const managed: ManagedBrowserConfig = {
  channel: "msedge",
  userDataDir: "/tmp/profile",
  headless: true,
  outputDir: "/tmp/artifacts",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-browser-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const configPath = (): string => join(dir, "cli.config.json");

describe("mergePlaywrightConfig", () => {
  it("writes the managed knobs into an empty config", () => {
    const result = mergePlaywrightConfig(undefined, managed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const browser = result.value.browser as Record<string, unknown>;
    const launch = browser.launchOptions as Record<string, unknown>;
    expect(browser.browserName).toBe("chromium");
    expect(browser.userDataDir).toBe("/tmp/profile");
    expect(launch.channel).toBe("msedge");
    expect(launch.headless).toBe(true);
    expect(launch.args).toEqual(expect.arrayContaining(["--no-first-run", "--no-default-browser-check"]));
    expect(launch.ignoreDefaultArgs).toContain(MOCK_KEYCHAIN_FLAG);
    expect(result.value.outputDir).toBe("/tmp/artifacts");
  });

  it("preserves keys it does not own and merges arrays", () => {
    const existing = {
      customTop: true,
      browser: {
        contextOptions: { viewport: { width: 1280, height: 720 } },
        launchOptions: { args: ["--lang=en-US"], ignoreDefaultArgs: ["--disable-field-trial-config"] },
      },
    };
    const result = mergePlaywrightConfig(existing, managed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const browser = result.value.browser as Record<string, unknown>;
    const launch = browser.launchOptions as Record<string, unknown>;
    expect(result.value.customTop).toBe(true);
    expect(browser.contextOptions).toEqual({ viewport: { width: 1280, height: 720 } });
    expect(launch.args).toEqual(expect.arrayContaining(["--lang=en-US", "--no-first-run"]));
    expect(launch.ignoreDefaultArgs).toEqual(expect.arrayContaining(["--disable-field-trial-config", MOCK_KEYCHAIN_FLAG]));
  });

  it("keeps ignoreDefaultArgs: true, which already drops --use-mock-keychain", () => {
    const result = mergePlaywrightConfig({ browser: { launchOptions: { ignoreDefaultArgs: true } } }, managed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const browser = result.value.browser as Record<string, unknown>;
    const launch = browser.launchOptions as Record<string, unknown>;
    expect(launch.ignoreDefaultArgs).toBe(true);
  });

  it("refuses to overwrite non-object shapes", () => {
    expect(mergePlaywrightConfig({ browser: "nope" }, managed).ok).toBe(false);
    expect(mergePlaywrightConfig({ browser: { launchOptions: 42 } }, managed).ok).toBe(false);
  });
});

describe("setHeadless", () => {
  it("flips only headless and keeps foreign keys untouched", () => {
    const merged = mergePlaywrightConfig(
      { browser: { contextOptions: { viewport: { width: 1280, height: 720 } }, launchOptions: { args: ["--lang=en-US"] } } },
      managed,
    );
    if (!merged.ok) throw new Error("merge failed");
    const next = setHeadless(merged.value, false);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const browser = next.value.browser as Record<string, unknown>;
    const launch = browser.launchOptions as Record<string, unknown>;
    expect(launch.headless).toBe(false);
    expect(launch.channel).toBe("msedge");
    expect(launch.args).toEqual(expect.arrayContaining(["--lang=en-US", "--no-first-run"]));
    expect(browser.contextOptions).toEqual({ viewport: { width: 1280, height: 720 } });
  });

  it("refuses non-object shapes", () => {
    expect(setHeadless({ browser: "x" }, false).ok).toBe(false);
    expect(setHeadless({ browser: { launchOptions: 7 } }, false).ok).toBe(false);
  });
});

describe("readPlaywrightConfig", () => {
  it("returns undefined for a missing file", () => {
    expect(readPlaywrightConfig(configPath())).toEqual({ ok: true, value: undefined });
  });

  it("reads a JSON object", () => {
    writeFileSync(configPath(), JSON.stringify({ outputDir: "/tmp/x" }));
    expect(readPlaywrightConfig(configPath())).toEqual({ ok: true, value: { outputDir: "/tmp/x" } });
  });

  it("refuses invalid JSON instead of guessing", () => {
    writeFileSync(configPath(), "{ not json");
    const result = readPlaywrightConfig(configPath());
    expect(result.ok).toBe(false);
    writeFileSync(configPath(), "[1,2,3]");
    expect(readPlaywrightConfig(configPath()).ok).toBe(false);
  });
});

describe("writePlaywrightConfig", () => {
  it("writes atomically with 0600 and backs up an existing file", () => {
    const original = mergePlaywrightConfig(undefined, managed);
    if (!original.ok) throw new Error("merge failed");
    const first = writePlaywrightConfig(configPath(), original.value);
    expect(first).toMatchObject({ ok: true, changed: true });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);

    const second = writePlaywrightConfig(configPath(), original.value);
    expect(second).toMatchObject({ ok: true, changed: false });

    const before = readFileSync(configPath(), "utf8");
    const changed = mergePlaywrightConfig(original.value, { ...managed, headless: false });
    if (!changed.ok) throw new Error("merge failed");
    const third = writePlaywrightConfig(configPath(), changed.value);
    expect(third).toMatchObject({ ok: true, changed: true });
    if (!third.ok || !third.backupPath) throw new Error("expected a backup");
    expect(readFileSync(third.backupPath, "utf8")).toBe(before);
    expect(JSON.parse(readFileSync(configPath(), "utf8")).browser.launchOptions.headless).toBe(false);
  });
});

describe("managedBrowserSummary", () => {
  it("extracts the managed fields and detects the mock-keychain flag", () => {
    const merged = mergePlaywrightConfig(undefined, managed);
    if (!merged.ok) throw new Error("merge failed");
    expect(managedBrowserSummary(merged.value)).toEqual({
      channel: "msedge",
      userDataDir: "/tmp/profile",
      headless: true,
      mockKeychainDisabled: true,
    });
    expect(managedBrowserSummary(undefined)).toEqual({ mockKeychainDisabled: false });
  });
});

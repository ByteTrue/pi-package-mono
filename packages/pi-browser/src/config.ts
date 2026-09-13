import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export type JsonObject = Record<string, unknown>;

/** The four knobs are load-bearing and verified; see codestable/issues/068-o-browser-package.md. */
export const MANAGED_BROWSER_NAME = "chromium";
export const MOCK_KEYCHAIN_FLAG = "--use-mock-keychain";
export const BASE_LAUNCH_ARGS = ["--no-first-run", "--no-default-browser-check"] as const;

export type ManagedBrowserConfig = {
  /** Playwright channel matching the import source family, e.g. "msedge". */
  channel: string;
  userDataDir: string;
  headless: boolean;
  outputDir: string;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type WriteResult = { ok: true; changed: boolean; backupPath?: string } | { ok: false; error: string };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeStringArray(current: unknown, required: readonly string[]): string[] {
  const base = Array.isArray(current)
    ? current.filter((entry): entry is string => typeof entry === "string")
    : [];
  const merged = new Set(base);
  for (const entry of required) merged.add(entry);
  return [...merged];
}

export function readPlaywrightConfig(path: string): Result<JsonObject | undefined> {
  if (!existsSync(path)) return { ok: true, value: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      ok: false,
      error: `${path} is not valid JSON (${message(error)}). Fix or remove it first; refusing to touch it.`,
    };
  }
  if (!isObject(parsed)) return { ok: false, error: `${path} must contain a JSON object.` };
  return { ok: true, value: parsed };
}

/** Merge our managed fields into an existing doc, preserving everything we do not own. */
export function mergePlaywrightConfig(
  existing: JsonObject | undefined,
  managed: ManagedBrowserConfig,
): Result<JsonObject> {
  const next: JsonObject = { ...(existing ?? {}) };

  if (next.browser !== undefined && !isObject(next.browser)) {
    return { ok: false, error: '"browser" in the playwright config is not an object; refusing to overwrite it.' };
  }
  const browser: JsonObject = isObject(next.browser) ? { ...next.browser } : {};

  if (browser.launchOptions !== undefined && !isObject(browser.launchOptions)) {
    return { ok: false, error: '"browser.launchOptions" in the playwright config is not an object; refusing to overwrite it.' };
  }
  const launchOptions: JsonObject = isObject(browser.launchOptions) ? { ...browser.launchOptions } : {};

  browser.browserName = MANAGED_BROWSER_NAME;
  browser.userDataDir = managed.userDataDir;
  launchOptions.channel = managed.channel;
  launchOptions.headless = managed.headless;
  launchOptions.args = mergeStringArray(launchOptions.args, BASE_LAUNCH_ARGS);
  // true means "ignore every Playwright default", which already drops --use-mock-keychain.
  if (launchOptions.ignoreDefaultArgs !== true) {
    launchOptions.ignoreDefaultArgs = mergeStringArray(launchOptions.ignoreDefaultArgs, [MOCK_KEYCHAIN_FLAG]);
  }
  browser.launchOptions = launchOptions;

  next.browser = browser;
  next.outputDir = managed.outputDir;
  return { ok: true, value: next };
}

/** What the browser config would look like right now, for status display. */
export function managedBrowserSummary(config: JsonObject | undefined): {
  channel?: string;
  userDataDir?: string;
  headless?: boolean;
  mockKeychainDisabled: boolean;
} {
  const browser = config && isObject(config.browser) ? config.browser : undefined;
  const launchOptions = browser && isObject(browser.launchOptions) ? browser.launchOptions : undefined;
  const ignoreDefaultArgs = launchOptions?.ignoreDefaultArgs;
  const mockKeychainDisabled =
    ignoreDefaultArgs === true ||
    (Array.isArray(ignoreDefaultArgs) && ignoreDefaultArgs.includes(MOCK_KEYCHAIN_FLAG));
  return {
    channel: typeof launchOptions?.channel === "string" ? launchOptions.channel : undefined,
    userDataDir: typeof browser?.userDataDir === "string" ? browser.userDataDir : undefined,
    headless: typeof launchOptions?.headless === "boolean" ? launchOptions.headless : undefined,
    mockKeychainDisabled,
  };
}

export function writePlaywrightConfig(path: string, value: JsonObject): WriteResult {
  const serialized = `${stableStringify(value)}\n`;
  const original = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (original === serialized) return { ok: true, changed: false };

  let backupPath: string | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (original !== undefined) {
      backupPath = `${path}.pi-browser-bak-${timestamp()}`;
      writeFileSync(backupPath, original, { mode: 0o600 });
    }
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, serialized, { mode: 0o600 });
    renameSync(temp, path);
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  return { ok: true, changed: true, ...(backupPath ? { backupPath } : {}) };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Sort keys recursively so "did this change?" is a string comparison. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

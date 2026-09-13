import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { DEFAULT_PROFILE_NAME } from "./paths.js";

export type BrowserImportSummary = {
  /** Source browser id ("msedge") and label ("Microsoft Edge"). */
  sourceBrowserId: string;
  sourceBrowserLabel: string;
  /** Display name and absolute dir of the source profile. */
  sourceProfile: string;
  sourceProfileDir: string;
  importedAt: string;
  bytesCopied?: number;
};

export type PiBrowserState = {
  version: 1;
  profileName: string;
  lastImport?: BrowserImportSummary;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function initialBrowserState(): PiBrowserState {
  return { version: 1, profileName: DEFAULT_PROFILE_NAME };
}

function parseImportSummary(value: unknown): BrowserImportSummary | undefined {
  if (!isObject(value)) return undefined;
  const { sourceBrowserId, sourceBrowserLabel, sourceProfile, sourceProfileDir, importedAt, bytesCopied } = value;
  if (
    typeof sourceBrowserId !== "string" ||
    typeof sourceBrowserLabel !== "string" ||
    typeof sourceProfile !== "string" ||
    typeof sourceProfileDir !== "string" ||
    typeof importedAt !== "string"
  ) {
    return undefined;
  }
  return {
    sourceBrowserId,
    sourceBrowserLabel,
    sourceProfile,
    sourceProfileDir,
    importedAt,
    ...(typeof bytesCopied === "number" ? { bytesCopied } : {}),
  };
}

/** State is a cache: missing or unreadable files simply mean "nothing recorded yet". */
export function readBrowserState(path: string): PiBrowserState | undefined {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || parsed.version !== 1) return undefined;
  const profileName =
    typeof parsed.profileName === "string" && parsed.profileName.trim()
      ? parsed.profileName
      : DEFAULT_PROFILE_NAME;
  const lastImport = parseImportSummary(parsed.lastImport);
  return { version: 1, profileName, ...(lastImport ? { lastImport } : {}) };
}

export function writeBrowserState(path: string, state: PiBrowserState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

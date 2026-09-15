import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type JsonObject = Record<string, unknown>;
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type WriteResult =
  | { ok: true; changed: boolean; backupPath?: string }
  | { ok: false; error: string };

export const MANAGED_SESSION = "pi-browser";
export const DEFAULT_IDLE_TIMEOUT = "10m";
export const DEFAULT_HEADED = false;

export type ManagedAgentBrowserConfig = {
  profile?: string;
  screenshotDir: string;
  headed: boolean;
  idleTimeout: string | number;
  executablePath?: string;
};

export type AgentBrowserConfigSummary = {
  profile?: string;
  session?: string;
  namespace?: string;
  engine?: string;
  headed?: boolean;
  idleTimeout?: string | number;
  screenshotDir?: string;
  executablePath?: string;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readAgentBrowserConfig(path: string): Result<JsonObject | undefined> {
  if (!existsSync(path)) return { ok: true, value: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      ok: false,
      error: `${path} is not valid JSON (${message(error)}). Fix or remove it first; refusing to overwrite it.`,
    };
  }
  return isObject(parsed)
    ? { ok: true, value: parsed }
    : { ok: false, error: `${path} must contain a JSON object.` };
}

/** Merge only the defaults pi-browser assists with; unrelated agent-browser settings survive. */
export function mergeAgentBrowserConfig(
  existing: JsonObject | undefined,
  managed: ManagedAgentBrowserConfig,
): JsonObject {
  const next: JsonObject = { ...(existing ?? {}) };
  next.engine = "chrome";
  next.headed = managed.headed;
  next.idleTimeout = managed.idleTimeout;
  next.screenshotDir = managed.screenshotDir;
  if (managed.executablePath) next.executablePath = managed.executablePath;
  // Official agent-browser posture: sessions run in isolated/ephemeral instances
  // so parallel tasks never fight for a single Chrome user-data-dir lock (exit 21).
  // Login state is saved & injected as portable state files under ~/.pi/agent/pi-browser/auth/.
  // No namespace or profile lock in global config: all tools use official defaults.
  delete next.profile;
  delete next.session;
  delete next.namespace;
  return next;
}

export function setHeaded(config: JsonObject, headed: boolean): JsonObject {
  return { ...config, headed };
}

export function setIdleTimeout(config: JsonObject, idleTimeout: string | number): JsonObject {
  return { ...config, idleTimeout };
}

export function setExecutablePath(config: JsonObject, executablePath: string | undefined): JsonObject {
  const next = { ...config };
  if (executablePath) next.executablePath = executablePath;
  else delete next.executablePath;
  return next;
}

export function agentBrowserConfigSummary(
  config: JsonObject | undefined,
): AgentBrowserConfigSummary {
  if (!config) return {};
  const string = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  const idleTimeout =
    typeof config.idleTimeout === "string" || typeof config.idleTimeout === "number"
      ? config.idleTimeout
      : undefined;
  return {
    ...(string(config.profile) ? { profile: string(config.profile) } : {}),
    ...(string(config.session) ? { session: string(config.session) } : {}),
    ...(string(config.namespace) ? { namespace: string(config.namespace) } : {}),
    ...(string(config.engine) ? { engine: string(config.engine) } : {}),
    ...(typeof config.headed === "boolean" ? { headed: config.headed } : {}),
    ...(idleTimeout !== undefined ? { idleTimeout } : {}),
    ...(string(config.screenshotDir) ? { screenshotDir: string(config.screenshotDir) } : {}),
    ...(string(config.executablePath) ? { executablePath: string(config.executablePath) } : {}),
  };
}

export function writeAgentBrowserConfig(path: string, value: JsonObject): WriteResult {
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
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, serialized, { mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  return { ok: true, changed: true, ...(backupPath ? { backupPath } : {}) };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Deterministic output keeps no-op writes and backups honest. */
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

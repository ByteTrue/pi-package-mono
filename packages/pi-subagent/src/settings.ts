import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { listBuiltinAgentNames } from "./builtin-agents.js";

export const SETTINGS_KEY = "subagent";
export const COMMAND_NAME = "subagent";

const PKG_CONFIG_DIRNAME = "pi-pkg-cfg";
const PKG_DIRNAME = "pi-subagent";
const PKG_FILENAME = "settings.json";

export type SettingsScope = "global" | "project";

export interface SubagentRoleConfig {
  model?: string;
  thinking?: string;
  tools?: string[];
}

export interface SubagentSettings {
  defaultModel?: string;
  defaultThinking?: string;
  agents?: Record<string, SubagentRoleConfig>;
  /**
   * Extra environment variables for every child pi process. Project values win
   * over global ones. This is a plain pass-through: the extension never inspects
   * or special-cases a name, so a child can be given any extension's switch
   * (for example disabling a proxy in children) without this package knowing
   * about that extension.
   */
  env?: Record<string, string>;
}

function parseEnvMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.trim();
    if (!name) continue;
    // Only strings are accepted. Numbers/booleans would be coerced silently and
    // a child that reads a switch as "0" would be surprised by `0` becoming "0.0".
    if (typeof value !== "string") continue;
    env[name] = value;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

/** Where a layer's values live, and whether that is still Pi's settings.json. */
export interface SettingsLocation {
  path: string;
  legacy: boolean;
}

type FileRead =
  | { state: "missing" }
  | { state: "invalid"; reason: "not-json" | "not-object" }
  | { state: "valid"; value: Record<string, unknown> };

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

/**
 * This package's own file. $PI_PKG_CFG_DIR moves the global root for cross-profile
 * setups; the project layer stays inside the project.
 */
export function settingsPathForScope(cwd: string, scope: SettingsScope): string {
  const root =
    scope === "project"
      ? join(cwd, ".pi", PKG_CONFIG_DIRNAME)
      : process.env.PI_PKG_CFG_DIR?.trim() || join(agentDir(), PKG_CONFIG_DIRNAME);
  return join(root, PKG_DIRNAME, PKG_FILENAME);
}

/** Pi's own settings.json: where this section lived before the migration. */
function legacySettingsPath(cwd: string, scope: SettingsScope): string {
  return scope === "project" ? join(cwd, ".pi", "settings.json") : join(agentDir(), "settings.json");
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Anything on disk counts: a directory or unreadable path must still fail closed. */
function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function readFileStrict(path: string): FileRead {
  if (!pathExists(path)) return { state: "missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { state: "invalid", reason: "not-json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { state: "invalid", reason: "not-object" };
  }
  return { state: "valid", value: parsed as Record<string, unknown> };
}

function invalidJsonMessage(path: string, reason: "not-json" | "not-object"): string {
  return reason === "not-json"
    ? `${path} is not valid JSON. Fix it first; refusing to overwrite it.`
    : `${path} is not a JSON object. Refusing to overwrite it.`;
}

/** Atomic single write: temp file in the same directory, then rename. */
function writeSectionFile(path: string, section: Record<string, unknown>, mode: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(section, null, 2)}\n`, {
    encoding: "utf-8",
    mode,
  });
  renameSync(tempPath, path);
}

/** The stored shape: only known keys, and empty values never linger. */
function toStoredSection(settings: SubagentSettings): Record<string, unknown> {
  const section: Record<string, unknown> = {};
  if (settings.defaultModel) section.defaultModel = settings.defaultModel;
  if (settings.defaultThinking) section.defaultThinking = settings.defaultThinking;
  if (settings.agents && Object.keys(settings.agents).length > 0) section.agents = settings.agents;
  if (settings.env && Object.keys(settings.env).length > 0) section.env = settings.env;
  return section;
}

function parseSubagentSection(rawSection: unknown, rootObj?: Record<string, unknown> | null): SubagentSettings {
  const settings: SubagentSettings = {};

  // 1. Try modern section: settings.subagent
  const s = rawSection && typeof rawSection === "object" && !Array.isArray(rawSection)
    ? (rawSection as Record<string, unknown>)
    : null;

  if (typeof s?.defaultModel === "string" && s.defaultModel.trim()) {
    settings.defaultModel = s.defaultModel.trim();
  }
  if (typeof s?.defaultThinking === "string" && s.defaultThinking.trim()) {
    settings.defaultThinking = s.defaultThinking.trim();
  }
  settings.env = parseEnvMap(s?.env);

  const agentsMap: Record<string, SubagentRoleConfig> = {};

  // Check modern settings.subagent.agents
  if (s?.agents && typeof s.agents === "object" && !Array.isArray(s.agents)) {
    for (const [name, cfg] of Object.entries(s.agents as Record<string, unknown>)) {
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
      const c = cfg as Record<string, unknown>;
      const role: SubagentRoleConfig = {};
      if (typeof c.model === "string" && c.model.trim()) role.model = c.model.trim();
      if (typeof c.thinking === "string" && c.thinking.trim()) role.thinking = c.thinking.trim();
      if (Array.isArray(c.tools)) {
        role.tools = c.tools.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
      }
      agentsMap[name] = role;
    }
  }

  // 2. Compatible with legacy settings.subagents (with 's') or settings.subagents.agentOverrides
  if (rootObj) {
    const legacy = rootObj["subagents"] as Record<string, unknown> | undefined;
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      const overrides = (legacy["agentOverrides"] ?? legacy["agents"]) as Record<string, unknown> | undefined;
      if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
        for (const [name, cfg] of Object.entries(overrides)) {
          if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
          if (agentsMap[name]) continue; // modern wins
          const c = cfg as Record<string, unknown>;
          const role: SubagentRoleConfig = {};
          if (typeof c.model === "string" && c.model.trim()) role.model = c.model.trim();
          if (typeof c.thinking === "string" && c.thinking.trim()) role.thinking = c.thinking.trim();
          if (Array.isArray(c.tools)) {
            role.tools = c.tools.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
          }
          agentsMap[name] = role;
        }
      }
    }

    // Root-level defaultProvider/defaultModel/defaultThinkingLevel are intentionally
    // NOT used as fallbacks: an unset subagent default means "inherit the parent
    // session's model"; the child pi process falls back to its own default by itself.
  }

  if (Object.keys(agentsMap).length > 0) {
    settings.agents = agentsMap;
  }
  if (!settings.env) delete settings.env;

  return settings;
}

/**
 * Where a layer's values currently live. A legacy section with settings is lifted
 * into this package's own file in one atomic write, so later writes can never
 * shadow the keys they did not touch. Unreadable legacy files stay in place and
 * are reported as the live path — reads fail soft on them, writes refuse.
 */
export function settingsLocationForScope(cwd: string, scope: SettingsScope): SettingsLocation {
  const target = settingsPathForScope(cwd, scope);
  if (isFile(target)) return { path: target, legacy: false };

  const legacy = legacySettingsPath(cwd, scope);
  const legacyRead = readFileStrict(legacy);
  if (legacyRead.state === "missing") return { path: target, legacy: false };
  if (legacyRead.state === "invalid") return { path: legacy, legacy: true };

  const settings = parseSubagentSection(legacyRead.value[SETTINGS_KEY], legacyRead.value);
  if (Object.keys(settings).length === 0) return { path: target, legacy: false };

  // Project override files stay read-only until the user explicitly writes one.
  if (scope === "project") return { path: legacy, legacy: true };

  try {
    writeSectionFile(target, toStoredSection(settings), 0o600);
  } catch {
    return { path: legacy, legacy: true };
  }
  return { path: target, legacy: false };
}

/** For status lines: says out loud when Pi's settings.json is still the live file. */
export function describeSettingsPathForScope(cwd: string, scope: SettingsScope): string {
  const location = settingsLocationForScope(cwd, scope);
  return location.legacy ? `${location.path} (legacy (read-only fallback))` : location.path;
}

function readLocationSettings(location: SettingsLocation): SubagentSettings {
  const read = readFileStrict(location.path);
  if (read.state !== "valid") return {};
  // Our own file holds the section itself; Pi's settings.json nests it under "subagent".
  return location.legacy
    ? parseSubagentSection(read.value[SETTINGS_KEY], read.value)
    : parseSubagentSection(read.value);
}

export function loadSubagentSettings(cwd: string, projectTrusted = true): SubagentSettings {
  const globalSettings = readLocationSettings(settingsLocationForScope(cwd, "global"));

  if (!projectTrusted) return globalSettings;

  const projectSettings = readLocationSettings(settingsLocationForScope(cwd, "project"));

  return {
    defaultModel: projectSettings.defaultModel ?? globalSettings.defaultModel,
    defaultThinking: projectSettings.defaultThinking ?? globalSettings.defaultThinking,
    agents: {
      ...(globalSettings.agents ?? {}),
      ...(projectSettings.agents ?? {}),
    },
    env: {
      ...(globalSettings.env ?? {}),
      ...(projectSettings.env ?? {}),
    },
  };
}

export function updateSubagentSettings(
  cwd: string,
  scope: SettingsScope,
  updater: (current: SubagentSettings) => SubagentSettings,
): string {
  const targetPath = settingsPathForScope(cwd, scope);
  const targetRead = readFileStrict(targetPath);
  if (targetRead.state === "invalid") {
    throw new Error(invalidJsonMessage(targetPath, targetRead.reason));
  }

  let current: SubagentSettings;
  let mode = 0o600;
  if (targetRead.state === "valid") {
    current = parseSubagentSection(targetRead.value);
    mode = statSync(targetPath).mode & 0o777;
  } else {
    // First write: carry the whole legacy section over in the same atomic write,
    // otherwise the untouched keys would be shadowed the moment the file exists.
    const legacyPath = legacySettingsPath(cwd, scope);
    const legacyRead = readFileStrict(legacyPath);
    if (legacyRead.state === "invalid") {
      throw new Error(invalidJsonMessage(legacyPath, legacyRead.reason));
    }
    current =
      legacyRead.state === "valid"
        ? parseSubagentSection(legacyRead.value[SETTINGS_KEY], legacyRead.value)
        : {};
  }

  writeSectionFile(targetPath, toStoredSection(updater(current)), mode);
  return targetPath;
}

export function listDiscoveredAgentNames(cwd: string): string[] {
  const names = new Set<string>();

  const scanDir = (dirPath: string) => {
    if (!existsSync(dirPath)) return;
    try {
      if (!statSync(dirPath).isDirectory()) return;
      const files = readdirSync(dirPath);
      for (const file of files) {
        if (file.endsWith(".md") && !file.startsWith(".")) {
          names.add(file.slice(0, -3));
        }
      }
    } catch {}
  };

  scanDir(join(cwd, ".pi", "agents"));
  const home = homedir();
  scanDir(join(agentDir(), "agents"));
  scanDir(join(home, ".pi", "agents"));

  // Include built-in roles, which ship as agent documents in the package.
  for (const builtIn of listBuiltinAgentNames()) {
    names.add(builtIn);
  }

  // Also include any agent roles explicitly configured in settings
  const settings = loadSubagentSettings(cwd, true);
  if (settings.agents) {
    for (const key of Object.keys(settings.agents)) {
      names.add(key);
    }
  }

  return Array.from(names).sort();
}

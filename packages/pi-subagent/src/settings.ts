import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BUILTIN_AGENTS } from "./builtin-agents.js";

export const SETTINGS_KEY = "subagent";
export const COMMAND_NAME = "subagent";

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
}

export function globalSettingsPath(): string {
  return join(
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
    "settings.json",
  );
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

export function settingsPathForScope(cwd: string, scope: SettingsScope): string {
  return scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
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

    // 3. Fallback to global defaultProvider + defaultModel if defaultModel still unset
    if (!settings.defaultModel) {
      const defaultProvider = typeof rootObj["defaultProvider"] === "string" ? rootObj["defaultProvider"].trim() : "";
      const defaultModelName = typeof rootObj["defaultModel"] === "string" ? rootObj["defaultModel"].trim() : "";
      if (defaultProvider && defaultModelName) {
        settings.defaultModel = `${defaultProvider}/${defaultModelName}`;
      } else if (defaultModelName) {
        settings.defaultModel = defaultModelName;
      }
    }

    if (!settings.defaultThinking && typeof rootObj["defaultThinkingLevel"] === "string") {
      settings.defaultThinking = rootObj["defaultThinkingLevel"].trim();
    }
  }

  if (Object.keys(agentsMap).length > 0) {
    settings.agents = agentsMap;
  }

  return settings;
}

export function loadSubagentSettings(cwd: string, projectTrusted = true): SubagentSettings {
  const globalObj = readJsonFile(globalSettingsPath());
  const globalSettings = parseSubagentSection(globalObj?.[SETTINGS_KEY], globalObj);

  if (!projectTrusted) return globalSettings;

  const projectObj = readJsonFile(projectSettingsPath(cwd));
  const projectSettings = parseSubagentSection(projectObj?.[SETTINGS_KEY], projectObj);

  return {
    defaultModel: projectSettings.defaultModel ?? globalSettings.defaultModel,
    defaultThinking: projectSettings.defaultThinking ?? globalSettings.defaultThinking,
    agents: {
      ...(globalSettings.agents ?? {}),
      ...(projectSettings.agents ?? {}),
    },
  };
}

export function updateSubagentSettings(
  cwd: string,
  scope: SettingsScope,
  updater: (current: SubagentSettings) => SubagentSettings,
): string {
  const targetPath = settingsPathForScope(cwd, scope);
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  const currentRoot = readJsonFile(targetPath) ?? {};
  const currentSubagent = parseSubagentSection(currentRoot[SETTINGS_KEY]);
  const updatedSubagent = updater(currentSubagent);

  // Clean empty values
  const cleanSubagent: Record<string, unknown> = {};
  if (updatedSubagent.defaultModel) cleanSubagent.defaultModel = updatedSubagent.defaultModel;
  if (updatedSubagent.defaultThinking) cleanSubagent.defaultThinking = updatedSubagent.defaultThinking;
  if (updatedSubagent.agents && Object.keys(updatedSubagent.agents).length > 0) {
    cleanSubagent.agents = updatedSubagent.agents;
  }

  const nextRoot: Record<string, unknown> = {
    ...currentRoot,
    [SETTINGS_KEY]: Object.keys(cleanSubagent).length > 0 ? cleanSubagent : undefined,
  };
  if (nextRoot[SETTINGS_KEY] === undefined) {
    delete nextRoot[SETTINGS_KEY];
  }

  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  const formatted = `${JSON.stringify(nextRoot, null, 2)}\n`;
  writeFileSync(tempPath, formatted, "utf-8");
  renameSync(tempPath, targetPath);

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
  scanDir(join(process.env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent"), "agents"));
  scanDir(join(home, ".pi", "agents"));

  // Include built-in roles (scout, researcher, reviewer)
  for (const builtIn of Object.keys(BUILTIN_AGENTS)) {
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

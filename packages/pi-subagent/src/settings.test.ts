import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  describeSettingsPathForScope,
  loadSubagentSettings,
  settingsPathForScope,
  updateSubagentSettings,
} from "./settings.js";

const ENV_KEYS = ["PI_CODING_AGENT_DIR", "PI_PKG_CFG_DIR"] as const;
const saved = new Map<string, string | undefined>();

let root: string;
let agentDir: string;
let cwd: string;

function newSettingsFile(): string {
  return join(agentDir, "pi-pkg-cfg", "pi-subagent", "settings.json");
}

function legacyGlobalFile(): string {
  return join(agentDir, "settings.json");
}

function projectSettingsFile(): string {
  return join(cwd, ".pi", "pi-pkg-cfg", "pi-subagent", "settings.json");
}

function legacyProjectFile(): string {
  return join(cwd, ".pi", "settings.json");
}

function read(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf-8"));
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  delete process.env.PI_PKG_CFG_DIR;
  root = join(tmpdir(), `pi-subagent-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  agentDir = join(root, "agent");
  cwd = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  rmSync(root, { recursive: true, force: true });
});

describe("settings location", () => {
  it("writes the section itself into this package's own file", () => {
    const path = updateSubagentSettings(cwd, "global", (current) => ({
      ...current,
      defaultModel: "vendor/model-a",
      agents: { scout: { model: "vendor/model-b", thinking: "low" } },
    }));

    expect(path).toBe(newSettingsFile());
    expect(read(path)).toEqual({
      defaultModel: "vendor/model-a",
      agents: { scout: { model: "vendor/model-b", thinking: "low" } },
    });
    // Pi's own settings.json is never created or touched.
    expect(() => statSync(legacyGlobalFile())).toThrow();
  });

  it("creates the config root with 0700 and the file with 0600", () => {
    const path = updateSubagentSettings(cwd, "global", () => ({ defaultModel: "vendor/model-a" }));

    expect(statSync(join(agentDir, "pi-pkg-cfg")).mode & 0o777).toBe(0o700);
    expect(statSync(join(agentDir, "pi-pkg-cfg", "pi-subagent")).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("honors an explicit file mode instead of forcing 0600", () => {
    const path = newSettingsFile();
    mkdirSync(join(agentDir, "pi-pkg-cfg", "pi-subagent"), { recursive: true });
    writeFileSync(path, "{}\n", { mode: 0o640 });

    updateSubagentSettings(cwd, "global", () => ({ defaultModel: "vendor/model-a" }));
    expect(statSync(path).mode & 0o777).toBe(0o640);
  });

  it("lets PI_PKG_CFG_DIR move the global root", () => {
    process.env.PI_PKG_CFG_DIR = join(root, "shared");
    expect(settingsPathForScope(cwd, "global")).toBe(
      join(root, "shared", "pi-subagent", "settings.json"),
    );
    // The project layer stays inside the project.
    expect(settingsPathForScope(cwd, "project")).toBe(projectSettingsFile());
  });
});

describe("legacy global migration", () => {
  it("lifts the whole section out of Pi's settings.json in one write", () => {
    const legacy = JSON.stringify(
      {
        defaultModel: "claude-opus-5",
        subagent: {
          defaultModel: "vendor/legacy-model",
          defaultThinking: "high",
          agents: { reviewer: { model: "vendor/legacy-reviewer" } },
        },
      },
      null,
      2,
    );
    writeFileSync(legacyGlobalFile(), legacy);

    expect(loadSubagentSettings(cwd).defaultModel).toBe("vendor/legacy-model");
    expect(read(newSettingsFile())).toEqual({
      defaultModel: "vendor/legacy-model",
      defaultThinking: "high",
      agents: { reviewer: { model: "vendor/legacy-reviewer" } },
    });
    // The old file keeps every byte, including Pi's own keys.
    expect(readFileSync(legacyGlobalFile(), "utf-8")).toBe(legacy);
  });

  it("keeps the inherited keys when only one value is changed", () => {
    writeFileSync(
      legacyGlobalFile(),
      JSON.stringify({ subagent: { defaultModel: "vendor/old", defaultThinking: "high" } }),
    );

    updateSubagentSettings(cwd, "global", (current) => ({ ...current, defaultThinking: "low" }));

    expect(read(newSettingsFile())).toEqual({
      defaultModel: "vendor/old",
      defaultThinking: "low",
    });
  });

  it("still reads and migrates the legacy subagents.agentOverrides shape", () => {
    writeFileSync(
      legacyGlobalFile(),
      JSON.stringify({
        subagents: {
          agentOverrides: { reviewer: { model: "vendor/legacy-reviewer", thinking: "high" } },
        },
      }),
    );

    expect(loadSubagentSettings(cwd).agents?.reviewer?.model).toBe("vendor/legacy-reviewer");
    expect(read(newSettingsFile())).toEqual({
      agents: { reviewer: { model: "vendor/legacy-reviewer", thinking: "high" } },
    });
  });

  it("ignores the legacy section once the new file exists", () => {
    writeFileSync(
      legacyGlobalFile(),
      JSON.stringify({ subagent: { defaultModel: "vendor/legacy-model" } }),
    );
    const path = newSettingsFile();
    mkdirSync(join(agentDir, "pi-pkg-cfg", "pi-subagent"), { recursive: true });
    writeFileSync(path, JSON.stringify({ defaultModel: "vendor/new-model" }));

    expect(loadSubagentSettings(cwd).defaultModel).toBe("vendor/new-model");
    expect(read(path)).toEqual({ defaultModel: "vendor/new-model" });
  });

  it("does not migrate when Pi's settings.json has no subagent section", () => {
    writeFileSync(legacyGlobalFile(), JSON.stringify({ defaultModel: "claude-opus-5" }));

    expect(loadSubagentSettings(cwd)).toEqual({ agents: {}, env: {} });
    expect(() => statSync(newSettingsFile())).toThrow();
  });

  it("fails closed on an unreadable legacy file, both reading and writing", () => {
    writeFileSync(legacyGlobalFile(), "{ not json");

    expect(() => updateSubagentSettings(cwd, "global", () => ({ defaultModel: "x" }))).toThrow(
      /not valid JSON/,
    );
    expect(readFileSync(legacyGlobalFile(), "utf-8")).toBe("{ not json");
    expect(() => statSync(newSettingsFile())).toThrow();
  });

  it("refuses to overwrite a broken new file", () => {
    const path = newSettingsFile();
    mkdirSync(join(agentDir, "pi-pkg-cfg", "pi-subagent"), { recursive: true });
    writeFileSync(path, "{ not json");

    expect(() => updateSubagentSettings(cwd, "global", () => ({ defaultModel: "x" }))).toThrow(
      /not valid JSON/,
    );
    expect(readFileSync(path, "utf-8")).toBe("{ not json");
  });

  it("marks the legacy path for status lines when the new root cannot be created", () => {
    writeFileSync(legacyGlobalFile(), JSON.stringify({ subagent: { defaultModel: "vendor/old" } }));
    // A plain file where the config root belongs: mkdir fails, so legacy stays live.
    writeFileSync(join(agentDir, "pi-pkg-cfg"), "");

    expect(describeSettingsPathForScope(cwd, "global")).toBe(
      `${legacyGlobalFile()} (legacy (read-only fallback))`,
    );
    expect(loadSubagentSettings(cwd).defaultModel).toBe("vendor/old");
  });
});

describe("project layer", () => {
  it("writes the project file in the project, never the legacy project file", () => {
    const path = updateSubagentSettings(cwd, "project", () => ({ defaultModel: "vendor/project" }));

    expect(path).toBe(projectSettingsFile());
    expect(read(path)).toEqual({ defaultModel: "vendor/project" });
    expect(() => statSync(legacyProjectFile())).toThrow();
  });

  it("reads the legacy project section without migrating it", () => {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      legacyProjectFile(),
      JSON.stringify({ subagent: { defaultModel: "vendor/legacy-project" } }),
    );

    expect(loadSubagentSettings(cwd, true).defaultModel).toBe("vendor/legacy-project");
    expect(describeSettingsPathForScope(cwd, "project")).toBe(
      `${legacyProjectFile()} (legacy (read-only fallback))`,
    );
    // Read-only: the user's repository is untouched and stays on the legacy path.
    expect(() => statSync(projectSettingsFile())).toThrow();
  });

  it("carries the legacy project section over on the first explicit project write", () => {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      legacyProjectFile(),
      JSON.stringify({ subagent: { defaultModel: "vendor/legacy-project", defaultThinking: "high" } }),
    );

    updateSubagentSettings(cwd, "project", (current) => ({ ...current, defaultThinking: "low" }));

    expect(read(projectSettingsFile())).toEqual({
      defaultModel: "vendor/legacy-project",
      defaultThinking: "low",
    });
  });

  it("overrides the global layer and skips the project layer when untrusted", () => {
    updateSubagentSettings(cwd, "global", () => ({
      defaultModel: "vendor/global",
      agents: { scout: { model: "vendor/global-scout" }, reviewer: { thinking: "high" } },
    }));
    updateSubagentSettings(cwd, "project", () => ({
      defaultModel: "vendor/project",
      agents: { scout: { model: "vendor/project-scout" } },
    }));

    const trusted = loadSubagentSettings(cwd, true);
    expect(trusted.defaultModel).toBe("vendor/project");
    expect(trusted.agents?.scout?.model).toBe("vendor/project-scout");
    expect(trusted.agents?.reviewer?.thinking).toBe("high");

    expect(loadSubagentSettings(cwd, false).defaultModel).toBe("vendor/global");
    expect(loadSubagentSettings(cwd, false).agents?.scout?.model).toBe("vendor/global-scout");
  });
});

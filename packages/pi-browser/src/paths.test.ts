import { afterEach, describe, expect, it } from "vitest";
import { activeConfigDir, agentsSkillsDir, artifactsDir, officialSkillDir, packageDir, playwrightConfigPath, profileDir, statePath } from "./paths.js";

const saved = {
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  PI_AGENT_HOME: process.env.PI_AGENT_HOME,
  PLAYWRIGHT_MCP_CONFIG: process.env.PLAYWRIGHT_MCP_CONFIG,
};

function restore(key: "PI_CODING_AGENT_DIR" | "PI_AGENT_HOME" | "PLAYWRIGHT_MCP_CONFIG", value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restore("PI_CODING_AGENT_DIR", saved.PI_CODING_AGENT_DIR);
  restore("PI_AGENT_HOME", saved.PI_AGENT_HOME);
  restore("PLAYWRIGHT_MCP_CONFIG", saved.PLAYWRIGHT_MCP_CONFIG);
});

describe("paths", () => {
  it("derives package locations from PI_CODING_AGENT_DIR", () => {
    process.env.PI_CODING_AGENT_DIR = "/tmp/agent-dir";
    delete process.env.PI_AGENT_HOME;

    expect(activeConfigDir()).toBe("/tmp/agent-dir");
    expect(packageDir()).toBe("/tmp/agent-dir/pi-browser");
    expect(profileDir()).toBe("/tmp/agent-dir/pi-browser/profiles/default");
    expect(profileDir("work")).toBe("/tmp/agent-dir/pi-browser/profiles/work");
    expect(artifactsDir()).toBe("/tmp/agent-dir/pi-browser/artifacts");
    expect(statePath()).toBe("/tmp/agent-dir/pi-browser/state.json");
  });

  it("falls back to PI_AGENT_HOME and then ~/.pi/agent", () => {
    delete process.env.PI_CODING_AGENT_DIR;
    process.env.PI_AGENT_HOME = "/tmp/agent-home";
    expect(activeConfigDir()).toBe("/tmp/agent-home");

    delete process.env.PI_AGENT_HOME;
    expect(activeConfigDir().endsWith("/.pi/agent")).toBe(true);
  });

  it("honors PLAYWRIGHT_MCP_CONFIG for the CLI config path", () => {
    process.env.PLAYWRIGHT_MCP_CONFIG = "/tmp/custom-config.json";
    expect(playwrightConfigPath()).toBe("/tmp/custom-config.json");

    delete process.env.PLAYWRIGHT_MCP_CONFIG;
    expect(playwrightConfigPath().endsWith("/.playwright/cli.config.json")).toBe(true);
  });

  it("points the official skill at ~/.agents/skills", () => {
    expect(officialSkillDir()).toBe(agentsSkillsDir() + "/playwright-cli");
  });
});

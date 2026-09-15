import { afterEach, describe, expect, it } from "vitest";
import {
  MANAGED_PROFILE_NAME,
  activeConfigDir,
  agentBrowserConfigPath,
  artifactsDir,
  legacyPlaywrightProfileDir,
  officialSkillDir,
  packageDir,
  profileDir,
  projectAgentBrowserConfigPath,
} from "./paths.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalPiHome = process.env.PI_AGENT_HOME;
const originalConfig = process.env.AGENT_BROWSER_CONFIG;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalPiHome === undefined) delete process.env.PI_AGENT_HOME;
  else process.env.PI_AGENT_HOME = originalPiHome;
  if (originalConfig === undefined) delete process.env.AGENT_BROWSER_CONFIG;
  else process.env.AGENT_BROWSER_CONFIG = originalConfig;
});

describe("paths", () => {
  it("keeps the new agent-browser profile separate from legacy Playwright data", () => {
    process.env.PI_CODING_AGENT_DIR = "/tmp/pi-agent";
    expect(activeConfigDir()).toContain("pi-agent");
    expect(packageDir()).toContain("pi-browser");
    expect(profileDir()).toContain(`profiles${process.platform === "win32" ? "\\" : "/"}${MANAGED_PROFILE_NAME}`);
    expect(legacyPlaywrightProfileDir()).toContain(`profiles${process.platform === "win32" ? "\\" : "/"}default`);
    expect(profileDir()).not.toBe(legacyPlaywrightProfileDir());
    expect(artifactsDir()).toContain("artifacts");
    expect(officialSkillDir()).toContain(`skills${process.platform === "win32" ? "\\" : "/"}agent-browser`);
  });

  it("respects the explicit agent-browser config env", () => {
    process.env.AGENT_BROWSER_CONFIG = "/tmp/custom-agent-browser.json";
    expect(agentBrowserConfigPath()).toContain("custom-agent-browser.json");
  });

  it("resolves project overrides from the supplied cwd", () => {
    expect(projectAgentBrowserConfigPath("/tmp/example")).toContain("agent-browser.json");
  });
});

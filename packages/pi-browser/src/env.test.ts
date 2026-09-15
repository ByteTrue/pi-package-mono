import { describe, expect, it } from "vitest";
import {
  INSTALL_SKILL_COMMAND,
  MIN_AGENT_BROWSER_VERSION,
  installedAgentBrowserSkillDir,
  isVersionAtLeast,
  parseVersion,
  probeAgentBrowser,
  type ExecFn,
} from "./env.js";

describe("agent-browser environment", () => {
  it("uses the confirmed Pi skill command", () => {
    expect(INSTALL_SKILL_COMMAND).toBe("npx skills add vercel-labs/agent-browser -a pi -y -g");
  });

  it("parses and compares versions numerically", () => {
    expect(parseVersion("agent-browser 0.37.1")).toBe("0.37.1");
    expect(parseVersion("none")).toBeUndefined();
    expect(isVersionAtLeast("0.37.1", MIN_AGENT_BROWSER_VERSION)).toBe(true);
    expect(isVersionAtLeast("0.37.0", MIN_AGENT_BROWSER_VERSION)).toBe(false);
    expect(isVersionAtLeast("1.0.0", MIN_AGENT_BROWSER_VERSION)).toBe(true);
  });

  it("reports ready, outdated and missing CLI states", async () => {
    const result = (stdout: string, code: number | null = 0): ExecFn => async () => ({
      stdout,
      stderr: "",
      code,
    });
    await expect(probeAgentBrowser(result("agent-browser 0.37.1"))).resolves.toMatchObject({ state: "ready" });
    await expect(probeAgentBrowser(result("agent-browser 0.36.0"))).resolves.toMatchObject({ state: "outdated" });
    await expect(probeAgentBrowser(result("not found", 127))).resolves.toMatchObject({ state: "missing" });
    const throwing: ExecFn = async () => {
      throw new Error("spawn ENOENT");
    };
    await expect(probeAgentBrowser(throwing)).resolves.toMatchObject({ state: "missing" });
  });

  it("finds the first candidate containing SKILL.md", () => {
    expect(installedAgentBrowserSkillDir(["/definitely/missing/a", "/definitely/missing/b"])).toBeUndefined();
  });
});

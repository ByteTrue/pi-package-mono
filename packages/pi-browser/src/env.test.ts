import { describe, expect, it } from "vitest";
import { MIN_CLI_VERSION, isVersionAtLeast, parseVersion, probePlaywrightCli, type ExecFn } from "./env.js";

describe("parseVersion", () => {
  it("reads the first semver in noisy output", () => {
    expect(parseVersion("0.1.19")).toBe("0.1.19");
    expect(parseVersion("playwright-cli 0.1.19\nsomething else")).toBe("0.1.19");
    expect(parseVersion("no version here")).toBeUndefined();
  });
});

describe("isVersionAtLeast", () => {
  it("compares numerically, not lexically", () => {
    expect(isVersionAtLeast("0.1.19", MIN_CLI_VERSION)).toBe(true);
    expect(isVersionAtLeast("0.1.18", MIN_CLI_VERSION)).toBe(false);
    expect(isVersionAtLeast("0.1.9", MIN_CLI_VERSION)).toBe(false);
    expect(isVersionAtLeast("0.2.0", MIN_CLI_VERSION)).toBe(true);
    expect(isVersionAtLeast("1.0.0", MIN_CLI_VERSION)).toBe(true);
  });
});

describe("probePlaywrightCli", () => {
  const ok = (stdout: string, code: number | null = 0): ExecFn => async () => ({ stdout, stderr: "", code });

  it("reports ready for a sufficient version", async () => {
    await expect(probePlaywrightCli(ok("0.1.19"))).resolves.toMatchObject({ state: "ready", version: "0.1.19" });
  });

  it("reports outdated below the minimum", async () => {
    await expect(probePlaywrightCli(ok("0.1.2"))).resolves.toMatchObject({ state: "outdated", version: "0.1.2" });
  });

  it("reports missing when the binary fails or cannot run", async () => {
    await expect(probePlaywrightCli(ok("command not found", 127))).resolves.toMatchObject({ state: "missing" });
    const throwing: ExecFn = async () => {
      throw new Error("spawn ENOENT");
    };
    await expect(probePlaywrightCli(throwing)).resolves.toMatchObject({ state: "missing" });
  });
});

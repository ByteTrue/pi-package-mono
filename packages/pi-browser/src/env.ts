import { existsSync } from "node:fs";
import { join } from "node:path";
import { officialSkillDir } from "./paths.js";

export type ExecResult = { stdout: string; stderr: string; code: number | null | undefined };
export type ExecFn = (command: string, args: string[], options?: { timeout?: number }) => Promise<ExecResult>;

/** Lowest version whose config keys the package relies on (verified with 0.1.19). */
export const MIN_CLI_VERSION = "0.1.19";

export type CliProbe =
  | { state: "missing"; detail: string }
  | { state: "outdated"; version: string; raw: string }
  | { state: "ready"; version: string; raw: string };

export type InstallCommand = { label: string; command: string; args: string[] };

export const INSTALL_CLI: InstallCommand = {
  label: "npm install -g @playwright/cli@latest",
  command: "npm",
  args: ["install", "-g", "@playwright/cli@latest"],
};

export const INSTALL_SKILL: InstallCommand = {
  label: "playwright-cli install --skills=agents -g",
  command: "playwright-cli",
  args: ["install", "--skills=agents", "-g"],
};

export function parseVersion(text: string): string | undefined {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(text);
  if (!match) return undefined;
  return match[1] + "." + match[2] + "." + match[3];
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const left = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = minimum.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export async function probePlaywrightCli(exec: ExecFn): Promise<CliProbe> {
  let result: ExecResult;
  try {
    result = await exec("playwright-cli", ["--version"], { timeout: 15_000 });
  } catch (error) {
    return { state: "missing", detail: error instanceof Error ? error.message : String(error) };
  }
  const raw = (result.stdout + "\n" + result.stderr).trim();
  const version = parseVersion(raw);
  if (result.code !== 0 || !version) {
    return {
      state: "missing",
      detail: raw || ("no output (exit code " + String(result.code) + "); is playwright-cli on PATH?"),
    };
  }
  return isVersionAtLeast(version, MIN_CLI_VERSION)
    ? { state: "ready", version, raw }
    : { state: "outdated", version, raw };
}

export function isPlaywrightSkillInstalled(path: string = officialSkillDir()): boolean {
  return existsSync(join(path, "SKILL.md"));
}

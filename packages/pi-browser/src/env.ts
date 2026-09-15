import { existsSync } from "node:fs";
import { join } from "node:path";
import { officialSkillCandidates } from "./paths.js";

export type ExecResult = { stdout: string; stderr: string; code: number | null | undefined };
export type ExecFn = (command: string, args: string[], options?: { timeout?: number }) => Promise<ExecResult>;

/** Lowest version whose persistent profile, idle timeout, JSON session info, and Windows cleanup we verified. */
export const MIN_AGENT_BROWSER_VERSION = "0.37.1";

export const INSTALL_CLI_COMMAND = "npm install -g agent-browser";
export const INSTALL_BROWSER_COMMAND = "agent-browser install";
export const INSTALL_SKILL_COMMAND = "npx skills add vercel-labs/agent-browser -a pi -y -g";
export const OPEN_SIGN_IN_COMMAND = "agent-browser --headed open about:blank";
export const CLOSE_BROWSER_COMMAND = "agent-browser close";

export type CliProbe =
  | { state: "missing"; detail: string }
  | { state: "outdated"; version: string; raw: string }
  | { state: "ready"; version: string; raw: string };

export function parseVersion(text: string): string | undefined {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(text);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
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

export async function probeAgentBrowser(exec: ExecFn): Promise<CliProbe> {
  let result: ExecResult;
  try {
    result = await exec("agent-browser", ["--version"], { timeout: 15_000 });
  } catch (error) {
    return { state: "missing", detail: error instanceof Error ? error.message : String(error) };
  }
  const raw = `${result.stdout}\n${result.stderr}`.trim();
  const version = parseVersion(raw);
  if (result.code !== 0 || !version) {
    return {
      state: "missing",
      detail: raw || `no output (exit code ${String(result.code)}); is agent-browser on PATH?`,
    };
  }
  return isVersionAtLeast(version, MIN_AGENT_BROWSER_VERSION)
    ? { state: "ready", version, raw }
    : { state: "outdated", version, raw };
}

export function installedAgentBrowserSkillDir(
  candidates: string[] = officialSkillCandidates(),
): string | undefined {
  return candidates.find((candidate) => existsSync(join(candidate, "SKILL.md")));
}

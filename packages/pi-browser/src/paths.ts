import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Pi's active agent config dir; same resolution order as other ByteTrue packages. */
export function activeConfigDir(): string {
  return resolve(
    process.env.PI_CODING_AGENT_DIR?.trim() ||
      process.env.PI_AGENT_HOME?.trim() ||
      join(homedir(), ".pi", "agent"),
  );
}

/** Everything pi-browser owns lives below this directory. */
export function packageDir(): string {
  return join(activeConfigDir(), "pi-browser");
}

export function profilesDir(): string {
  return join(packageDir(), "profiles");
}

/** Deliberately different from the old Playwright/Edge copy profile. */
export const MANAGED_PROFILE_NAME = "agent-browser";

export function profileDir(): string {
  return join(profilesDir(), MANAGED_PROFILE_NAME);
}

/** Kept only so status can explain that v0.2 data was not silently reused or deleted. */
export function legacyPlaywrightProfileDir(): string {
  return join(profilesDir(), "default");
}

export function artifactsDir(): string {
  return join(packageDir(), "artifacts");
}

export function agentBrowserHomeDir(): string {
  return join(homedir(), ".agent-browser");
}

export function agentBrowserBrowsersDir(): string {
  return join(agentBrowserHomeDir(), "browsers");
}

/** Explicit config env wins because agent-browser itself follows the same rule. */
export function agentBrowserConfigPath(): string {
  return resolve(
    process.env.AGENT_BROWSER_CONFIG?.trim() || join(agentBrowserHomeDir(), "config.json"),
  );
}

export function projectAgentBrowserConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, "agent-browser.json");
}

/** `skills add ... -a pi -g` installs here for the active Pi agent directory. */
export function officialSkillDir(): string {
  return join(activeConfigDir(), "skills", "agent-browser");
}

/** Tolerate the generic global agent-skills location used by older skills releases. */
export function officialSkillCandidates(): string[] {
  const candidates = [officialSkillDir(), join(homedir(), ".agents", "skills", "agent-browser")];
  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

export function existingOfficialSkillDir(): string | undefined {
  return officialSkillCandidates().find((candidate) => existsSync(join(candidate, "SKILL.md")));
}

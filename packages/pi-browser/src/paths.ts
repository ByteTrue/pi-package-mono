import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Pi's agent config dir; same resolution order as pi-image-gen. */
export function activeConfigDir(): string {
  return resolve(
    process.env.PI_CODING_AGENT_DIR?.trim() ||
      process.env.PI_AGENT_HOME?.trim() ||
      join(homedir(), ".pi", "agent"),
  );
}

/** Everything this package owns lives under this dir. */
export function packageDir(): string {
  return join(activeConfigDir(), "pi-browser");
}

export function profilesDir(): string {
  return join(packageDir(), "profiles");
}

export const DEFAULT_PROFILE_NAME = "default";

export function profileDir(name: string = DEFAULT_PROFILE_NAME): string {
  return join(profilesDir(), name);
}

export function artifactsDir(): string {
  return join(packageDir(), "artifacts");
}

export function statePath(): string {
  return join(packageDir(), "state.json");
}

/** Global playwright-cli config. PLAYWRIGHT_MCP_CONFIG overrides the default location. */
export function playwrightConfigPath(): string {
  return resolve(
    process.env.PLAYWRIGHT_MCP_CONFIG?.trim() || join(homedir(), ".playwright", "cli.config.json"),
  );
}

/** Where `playwright-cli install --skills=agents -g` puts the official skill (Pi reads this dir). */
export function agentsSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

export function officialSkillDir(): string {
  return join(agentsSkillsDir(), "playwright-cli");
}

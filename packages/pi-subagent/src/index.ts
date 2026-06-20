/**
 * @bytetrue/pi-subagent — Claude Code-style subagents for the pi coding agent.
 *
 * Registers a single `Agent` tool (delegate to an isolated specialist subagent by
 * `subagent_type` + `prompt`) and a `/subagent` command (list/inspect/configure
 * subagents). Subagents are Markdown files (frontmatter + system-prompt body)
 * discovered from ~/.pi/subagents and ./.pi/subagents, merged over three built-ins
 * (general-purpose, explore, plan). Everything is tool-driven; no TUI required.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadProfiles } from "./loader.js";
import { type AgentsDeps, registerAgentTool, registerSubagentCommand } from "./tools.js";

export { BUILTIN_PROFILES } from "./builtins.js";
export {
	type AgentsConfig,
	AgentsConfigSchema,
	applyConfigOverrides,
	getConfigPath,
	readConfig,
	setAgentModel,
	writeConfig,
} from "./config.js";
export { type LoadProfilesResult, loadProfiles } from "./loader.js";
export { resolveModel } from "./model.js";
export { type RunOptions, type RunResult, runSubagent } from "./runner.js";
export { type AgentsDeps, registerAgentTool, registerSubagentCommand } from "./tools.js";
export type {
	AgentFrontmatter,
	AgentProfile,
	ModelResolution,
	ModelResolveContext,
	PiModel,
	ProfileSource,
} from "./types.js";

export default async function registerSubagents(pi: ExtensionAPI): Promise<void> {
	const deps: AgentsDeps = { loadProfiles };
	registerAgentTool(pi, deps);
	registerSubagentCommand(pi, deps);
}

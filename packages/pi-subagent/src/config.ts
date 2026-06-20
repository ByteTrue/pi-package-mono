/**
 * Self-contained config for ~/.pi/byte-pi-subagent/config.json.
 *
 * Zero external deps beyond typebox. Fail-soft: malformed JSON or a schema
 * violation degrades to `{}` so a broken config never crashes startup — the
 * built-in subagents keep working with no config at all.
 *
 * Shape: `{ agents?: { <name>: { model?, tools?, disallowedTools? } } }`.
 * A per-agent entry overrides the matching profile's fields; config wins over
 * the `.md` frontmatter (which in turn wins over the built-in defaults).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { AgentProfile } from "./types.js";

/** Per-agent override entry: same surface as the `.md` frontmatter knobs. */
const AgentOverrideSchema = Type.Object({
	/** Model spec ("inherit" | alias | "provider/model-id"). Overrides the profile's model. */
	model: Type.Optional(Type.String()),
	/** Comma-separated tool allowlist. Overrides the profile's allowlist. */
	tools: Type.Optional(Type.String()),
	/** Comma-separated tool denylist. Overrides the profile's denylist. */
	disallowedTools: Type.Optional(Type.String()),
});

export const AgentsConfigSchema = Type.Object(
	{
		/** Per-agent overrides, keyed by agent name. Wins over the profile's own fields. */
		agents: Type.Optional(Type.Record(Type.String(), AgentOverrideSchema)),
	},
	{ additionalProperties: true },
);

export type AgentsConfig = Static<typeof AgentsConfigSchema>;

function configDir(): string {
	// Live under pi's own config dir (~/.pi), overridable via PI_CONFIG_DIR.
	// Resolved lazily (not at module load) so a per-test PI_CONFIG_DIR stub takes effect.
	const base = process.env.PI_CONFIG_DIR?.trim() || join(homedir(), ".pi");
	return join(base, "byte-pi-subagent");
}

export function getConfigPath(): string {
	return join(configDir(), "config.json");
}

export function readConfig(): AgentsConfig {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(getConfigPath(), "utf8"));
	} catch {
		return {} as AgentsConfig;
	}
	if (!Value.Check(AgentsConfigSchema, raw)) return {} as AgentsConfig;
	return raw as AgentsConfig;
}

/** Persist config to disk (creating the dir). Fail-soft: returns false on error. */
export function writeConfig(config: AgentsConfig): boolean {
	try {
		mkdirSync(dirname(getConfigPath()), { recursive: true });
		writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
		return true;
	} catch {
		return false;
	}
}

/**
 * Return a copy of `config` with `agents[name].model` set (or, for "inherit",
 * the model override removed so it falls back to the profile default). Drops a
 * now-empty per-agent entry. Pure — never mutates the input.
 */
export function setAgentModel(config: AgentsConfig, name: string, model: string): AgentsConfig {
	const agents = { ...(config.agents ?? {}) };
	const entry = { ...(agents[name] ?? {}) };
	if (model === "inherit") {
		delete entry.model;
	} else {
		entry.model = model;
	}
	if (Object.keys(entry).length === 0) {
		delete agents[name];
	} else {
		agents[name] = entry;
	}
	return { ...config, agents };
}

/** Split a comma-separated tool list into a trimmed, non-empty string[]. */
function parseToolList(spec: string): string[] {
	return spec
		.split(",")
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

/**
 * Apply the user's per-agent config override on top of a profile.
 *
 * If `config.agents[profile.name]` exists, its `model` / `tools` /
 * `disallowedTools` replace the corresponding profile fields (config wins over
 * `.md` frontmatter). Otherwise the profile is returned unchanged. Never mutates
 * the input — returns a fresh profile when an override applies.
 */
export function applyConfigOverrides(profile: AgentProfile, config: AgentsConfig): AgentProfile {
	const override = config.agents?.[profile.name];
	if (!override) return profile;

	const next: AgentProfile = { ...profile };
	if (override.model !== undefined) next.model = override.model;
	if (override.tools !== undefined) next.tools = parseToolList(override.tools);
	if (override.disallowedTools !== undefined) {
		next.disallowedTools = parseToolList(override.disallowedTools);
	}
	return next;
}

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AgentsConfig, applyConfigOverrides, readConfig, setAgentModel, writeConfig } from "./config.js";
import type { AgentProfile } from "./types.js";

afterEach(() => vi.unstubAllEnvs());

/** Point PI_CONFIG_DIR at a fresh temp dir and write config.json under byte-pi-subagent/. */
function stubConfig(contents: string | undefined): string {
	const base = mkdtempSync(join(tmpdir(), "pi-agents-test-"));
	vi.stubEnv("PI_CONFIG_DIR", base);
	if (contents !== undefined) {
		const dir = join(base, "byte-pi-subagent");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.json"), contents, "utf8");
	}
	return base;
}

const baseProfile: AgentProfile = {
	name: "explore",
	description: "Read-only exploration.",
	systemPrompt: "explore the code",
	tools: ["read", "grep"],
	disallowedTools: ["write"],
	model: "haiku",
	source: "builtin",
};

describe("readConfig (fail-soft)", () => {
	it("returns {} when the file is missing", () => {
		const base = stubConfig(undefined);
		try {
			expect(readConfig()).toEqual({});
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it("returns {} on malformed JSON", () => {
		const base = stubConfig("{ not valid json");
		try {
			expect(readConfig()).toEqual({});
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it("returns {} when the JSON violates the schema", () => {
		// `agents` must be a record of objects, not a string.
		const base = stubConfig(JSON.stringify({ agents: "nope" }));
		try {
			expect(readConfig()).toEqual({});
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it("parses a valid config", () => {
		const base = stubConfig(JSON.stringify({ agents: { explore: { model: "sonnet", thinking: "high" } } }));
		try {
			expect(readConfig()).toEqual({ agents: { explore: { model: "sonnet", thinking: "high" } } });
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});
});

describe("applyConfigOverrides", () => {
	it("returns the profile unchanged when no entry matches", () => {
		const result = applyConfigOverrides(baseProfile, { agents: { other: { model: "opus" } } });
		expect(result).toBe(baseProfile);
	});

	it("returns the profile unchanged when config has no agents", () => {
		expect(applyConfigOverrides(baseProfile, {})).toBe(baseProfile);
	});

	it("overrides the model", () => {
		const result = applyConfigOverrides(baseProfile, { agents: { explore: { model: "opus" } } });
		expect(result.model).toBe("opus");
		// Other fields untouched, input not mutated.
		expect(result.tools).toEqual(["read", "grep"]);
		expect(baseProfile.model).toBe("haiku");
		expect(result).not.toBe(baseProfile);
	});

	it("overrides valid thinking values", () => {
		const result = applyConfigOverrides(baseProfile, { agents: { explore: { thinking: "xhigh" } } });
		expect(result.thinking).toBe("xhigh");
		expect(result.model).toBe("haiku");
		expect(result).not.toBe(baseProfile);
	});

	it("ignores invalid thinking values without dropping other overrides", () => {
		const profile: AgentProfile = { ...baseProfile, thinking: "minimal" };
		const result = applyConfigOverrides(profile, {
			agents: { explore: { thinking: "huge", tools: "read" } },
		});
		expect(result.thinking).toBe("minimal");
		expect(result.tools).toEqual(["read"]);
	});

	it("overrides tools and disallowedTools from comma-separated strings", () => {
		const result = applyConfigOverrides(baseProfile, {
			agents: { explore: { tools: "read, bash , ls", disallowedTools: "write,edit" } },
		});
		expect(result.tools).toEqual(["read", "bash", "ls"]);
		expect(result.disallowedTools).toEqual(["write", "edit"]);
		// Model left as the profile's own value when not overridden.
		expect(result.model).toBe("haiku");
	});

	it("only replaces the fields present in the entry", () => {
		const result = applyConfigOverrides(baseProfile, { agents: { explore: { tools: "read" } } });
		expect(result.tools).toEqual(["read"]);
		expect(result.model).toBe("haiku");
		expect(result.disallowedTools).toEqual(["write"]);
	});
});

describe("writeConfig + setAgentModel", () => {
	it("round-trips a written config through readConfig", () => {
		const base = stubConfig(undefined);
		try {
			const cfg: AgentsConfig = { agents: { explore: { model: "bytetrueapi/deepseek-v4-flash" } } };
			expect(writeConfig(cfg)).toBe(true);
			expect(readConfig()).toEqual(cfg);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it("sets a model without mutating the input and preserves other agents", () => {
		const cfg: AgentsConfig = { agents: { plan: { model: "x" } } };
		const next = setAgentModel(cfg, "explore", "openai/gpt-5");
		expect(next.agents?.explore?.model).toBe("openai/gpt-5");
		expect(next.agents?.plan?.model).toBe("x");
		expect(cfg.agents?.explore).toBeUndefined(); // input untouched
	});

	it('drops the model override (and empty entry) for "inherit"', () => {
		const cfg: AgentsConfig = { agents: { explore: { model: "openai/gpt-5" } } };
		const next = setAgentModel(cfg, "explore", "inherit");
		expect(next.agents?.explore).toBeUndefined();
	});

	it('keeps other override fields when set to "inherit"', () => {
		const cfg: AgentsConfig = { agents: { explore: { model: "x", tools: "read" } } };
		const next = setAgentModel(cfg, "explore", "inherit");
		expect(next.agents?.explore?.model).toBeUndefined();
		expect(next.agents?.explore?.tools).toBe("read");
	});
});

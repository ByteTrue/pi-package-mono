import { describe, expect, it } from "vitest";
import { acquireOneModel, resolveModelConfig, stripTrailingV1 } from "./model-pick.js";
import { createScriptedQuickUI } from "./quick-adapter.js";

// Fully hermetic defaults: no official catalog, no catalog search hits.
const NO_CATALOG = { enrich: { catalog: null, templates: [] }, searchCatalog: async () => [] };

/** Fake catalog search returning one choice per (provider, modelId) pair. */
function catalogHits(...pairs: [provider: string, modelId: string][]) {
	return async () => pairs.map(([provider, modelId]) => ({ provider, modelId, model: { id: modelId } }));
}

function officialModel(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		name: id,
		api: "openai-completions",
		baseUrl: "https://api.vendor.test/v1",
		apiKey: "sk-official-secret",
		headers: { Authorization: "Bearer official" },
		authHeader: true,
		provider: "official",
		contextWindow: 200000,
		maxTokens: 8192,
		cost: { input: 1, output: 2 },
		...extra,
	};
}

describe("stripTrailingV1", () => {
	it("removes a trailing /v1 segment", () => {
		expect(stripTrailingV1("https://relay.test/v1")).toBe("https://relay.test");
		expect(stripTrailingV1("https://relay.test/v1/")).toBe("https://relay.test");
		expect(stripTrailingV1("https://relay.test/api/v1")).toBe("https://relay.test/api");
	});

	it("returns null when there is no trailing /v1", () => {
		expect(stripTrailingV1("https://relay.test")).toBeNull();
		expect(stripTrailingV1("https://relay.test/v2")).toBeNull();
		expect(stripTrailingV1("https://relay.test/v1beta")).toBeNull();
		expect(stripTrailingV1("not a url")).toBeNull();
	});
});

describe("resolveModelConfig", () => {
	it("writes a minimal entry and warns when the catalog has no candidate", async () => {
		const ui = createScriptedQuickUI({});
		const model = await resolveModelConfig(ui, "mystery-1", { baseUrl: "https://relay.test/v1", api: "openai-completions" }, NO_CATALOG.enrich);

		expect(model).toMatchObject({ id: "mystery-1", api: "openai-completions" });
		expect(ui.notifies.some((n) => n.level === "warning")).toBe(true);
		expect(ui.calls.filter((c) => c.kind === "select")).toHaveLength(0);
	});

	it("applies the single official template without asking", async () => {
		const ui = createScriptedQuickUI({});
		const model = await resolveModelConfig(
			ui,
			"gpt-5",
			{ baseUrl: "https://relay.test/v1", api: "openai-completions" },
			{ catalog: { openai: { "gpt-5": officialModel("gpt-5") } } },
		);

		expect(model).toMatchObject({ id: "gpt-5", contextWindow: 200000, maxTokens: 8192, cost: { input: 1, output: 2 } });
		// Routing and credentials of the official source are never copied.
		expect(model).not.toHaveProperty("apiKey");
		expect(model).not.toHaveProperty("baseUrl");
		expect(model).not.toHaveProperty("headers");
		expect(model).not.toHaveProperty("authHeader");
		expect(model).not.toHaveProperty("provider");
		expect(ui.calls.filter((c) => c.kind === "select")).toHaveLength(0);
		expect(ui.notifies.some((n) => n.message.includes("openai"))).toBe(true);
	});

	it("asks which official source to use when several templates exist", async () => {
		const ui = createScriptedQuickUI({ select: () => "1" });
		const model = await resolveModelConfig(
			ui,
			"claude-x",
			{ baseUrl: "https://relay.test/v1", api: "openai-completions" },
			{
				catalog: {
					anthropic: { "claude-x": officialModel("claude-x", { name: "via anthropic" }) },
					bedrock: { "claude-x": officialModel("claude-x", { name: "via bedrock" }) },
				},
			},
		);

		expect(model?.name).toBe("via bedrock");
		const select = ui.calls.find((c) => c.kind === "select");
		expect(select?.message).toContain("2 official templates");
	});

	it("cancels when the source selection is escaped", async () => {
		const ui = createScriptedQuickUI({ select: () => null });
		const model = await resolveModelConfig(
			ui,
			"claude-x",
			{ baseUrl: "https://relay.test/v1", api: "openai-completions" },
			{
				catalog: {
					anthropic: { "claude-x": officialModel("claude-x") },
					bedrock: { "claude-x": officialModel("claude-x") },
				},
			},
		);

		expect(model).toBeNull();
	});

	it("overrides baseUrl without /v1 for anthropic-messages models", async () => {
		const ui = createScriptedQuickUI({});
		const model = await resolveModelConfig(
			ui,
			"claude-x",
			{ baseUrl: "https://relay.test/v1", api: "openai-completions" },
			{ catalog: { anthropic: { "claude-x": officialModel("claude-x", { api: "anthropic-messages" }) } } },
		);

		expect(model).toMatchObject({ api: "anthropic-messages", baseUrl: "https://relay.test" });
	});

	it("leaves baseUrl alone for anthropic-messages when the provider url has no /v1", async () => {
		const ui = createScriptedQuickUI({});
		const model = await resolveModelConfig(
			ui,
			"claude-x",
			{ baseUrl: "https://relay.test", api: "openai-completions" },
			{ catalog: { anthropic: { "claude-x": officialModel("claude-x", { api: "anthropic-messages" }) } } },
		);

		expect(model?.baseUrl).toBeUndefined();
	});

	it("leaves baseUrl alone for non-anthropic models on a /v1 provider", async () => {
		const ui = createScriptedQuickUI({});
		const model = await resolveModelConfig(
			ui,
			"gpt-5",
			{ baseUrl: "https://relay.test/v1", api: "openai-completions" },
			{ catalog: { openai: { "gpt-5": officialModel("gpt-5") } } },
		);

		expect(model?.baseUrl).toBeUndefined();
	});
});

describe("acquireOneModel", () => {
	const target = { baseUrl: "https://relay.test/v1", api: "openai-completions", apiKey: "sk-user" };

	it("lists upstream ids and picks one", async () => {
		const ui = createScriptedQuickUI({ select: () => "upstream-b" });
		const model = await acquireOneModel(ui, target, {
			...NO_CATALOG,
			discover: async () => ["upstream-a", "upstream-b"],
		});

		expect(model).toMatchObject({ id: "upstream-b" });
		const select = ui.calls.find((c) => c.kind === "select");
		expect(select?.choices).toEqual(["upstream-a", "upstream-b"]);
	});

	it("offers a fuzzy filter for long upstream lists", async () => {
		const ids = Array.from({ length: 40 }, (_, i) => `model-${i}`).concat("claude-sonnet-4-5", "claude-opus-4-5");
		const ui = createScriptedQuickUI({
			input: () => "claude",
			select: () => "claude-opus-4-5",
		});

		const model = await acquireOneModel(ui, target, { ...NO_CATALOG, discover: async () => ids });

		expect(model).toMatchObject({ id: "claude-opus-4-5" });
		const select = ui.calls.find((c) => c.kind === "select");
		expect(select?.choices).toEqual(["claude-sonnet-4-5", "claude-opus-4-5"]);
	});

	it("falls back to the full list when the filter matches nothing", async () => {
		const ids = Array.from({ length: 30 }, (_, i) => `model-${i}`);
		const ui = createScriptedQuickUI({ input: () => "zzzz", select: () => "model-3" });

		const model = await acquireOneModel(ui, target, { ...NO_CATALOG, discover: async () => ids });

		expect(model).toMatchObject({ id: "model-3" });
		expect(ui.calls.find((c) => c.kind === "select")?.choices).toHaveLength(30);
	});

	it("skips the filter for short upstream lists", async () => {
		const ui = createScriptedQuickUI({ select: () => "only-one" });
		await acquireOneModel(ui, target, { ...NO_CATALOG, discover: async () => ["only-one"] });

		expect(ui.calls.filter((c) => c.kind === "input")).toHaveLength(0);
	});

	it("falls back to a typed id when discovery fails", async () => {
		const ui = createScriptedQuickUI({ input: () => "hand-typed" });
		const model = await acquireOneModel(ui, target, {
			...NO_CATALOG,
			discover: async () => {
				throw new Error("boom");
			},
		});

		expect(model).toMatchObject({ id: "hand-typed" });
		expect(ui.notifies.some((n) => n.level === "warning")).toBe(true);
		// Internal failure detail is never echoed to the user.
		expect(ui.notifies.every((n) => !n.message.includes("boom"))).toBe(true);
	});

	it("falls back to a typed id when the provider returns no models", async () => {
		const ui = createScriptedQuickUI({ input: () => "hand-typed" });
		const model = await acquireOneModel(ui, target, { ...NO_CATALOG, discover: async () => [] });

		expect(model).toMatchObject({ id: "hand-typed" });
	});

	it("skips discovery for an unsaved !command credential", async () => {
		let called = false;
		const ui = createScriptedQuickUI({ input: () => "hand-typed" });
		await acquireOneModel(
			ui,
			{ baseUrl: "https://relay.test/v1", api: "openai-completions", apiKey: "!echo secret" },
			{
				...NO_CATALOG,
				discover: async () => {
					called = true;
					return ["never"];
				},
			},
		);

		expect(called).toBe(false);
	});

	it("allows discovery for a saved !command credential", async () => {
		let called = false;
		const ui = createScriptedQuickUI({ select: () => "from-upstream" });
		await acquireOneModel(
			ui,
			{
				baseUrl: "https://relay.test/v1",
				api: "openai-completions",
				apiKey: "!echo secret",
				initialProvider: { apiKey: "!echo secret" },
			},
			{
				...NO_CATALOG,
				discover: async () => {
					called = true;
					return ["from-upstream"];
				},
			},
		);

		expect(called).toBe(true);
	});

	it("cancels when the model id prompt is escaped", async () => {
		const ui = createScriptedQuickUI({ input: () => null });
		const model = await acquireOneModel(ui, target, { ...NO_CATALOG, discover: async () => [] });

		expect(model).toBeNull();
	});

	it("searches the official catalog for a typed fragment", async () => {
		const ui = createScriptedQuickUI({ input: () => "opus", select: () => "claude-opus-4-5" });
		const model = await acquireOneModel(ui, target, {
			enrich: { catalog: { anthropic: { "claude-opus-4-5": { id: "claude-opus-4-5", name: "Claude Opus 4.5" } } } },
			discover: async () => [],
			searchCatalog: catalogHits(["anthropic", "claude-opus-4-5"], ["bedrock", "claude-opus-4-5"], ["anthropic", "claude-opus-4-1"]),
		});

		expect(model).toMatchObject({ id: "claude-opus-4-5", name: "Claude Opus 4.5" });
		// Distinct ids only, plus an escape hatch for the literal text.
		const select = ui.calls.find((c) => c.kind === "select");
		expect(select?.message).toContain('matches for "opus"');
		expect(select?.choices?.slice(0, 2)).toEqual(["claude-opus-4-5", "claude-opus-4-1"]);
		expect(select?.choices).toHaveLength(3);
	});

	it("keeps the typed text reachable when the catalog also matches", async () => {
		const ui = createScriptedQuickUI({
			input: () => "opus",
			// The escape-hatch choice is the last one.
			select: () => "\u0000literal",
		});
		const model = await acquireOneModel(ui, target, {
			...NO_CATALOG,
			discover: async () => [],
			searchCatalog: catalogHits(["anthropic", "claude-opus-4-5"]),
		});

		expect(model).toMatchObject({ id: "opus" });
	});

	it("skips the catalog select when nothing matches", async () => {
		const ui = createScriptedQuickUI({ input: () => "totally-custom" });
		const model = await acquireOneModel(ui, target, { ...NO_CATALOG, discover: async () => [] });

		expect(model).toMatchObject({ id: "totally-custom" });
		expect(ui.calls.filter((c) => c.kind === "select")).toHaveLength(0);
	});

	it("skips the catalog select when the only match is the typed id itself", async () => {
		const ui = createScriptedQuickUI({ input: () => "claude-opus-4-5" });
		const model = await acquireOneModel(ui, target, {
			enrich: { catalog: { anthropic: { "claude-opus-4-5": { id: "claude-opus-4-5" } } } },
			discover: async () => [],
			searchCatalog: catalogHits(["anthropic", "claude-opus-4-5"]),
		});

		expect(model).toMatchObject({ id: "claude-opus-4-5" });
		expect(ui.calls.filter((c) => c.kind === "select")).toHaveLength(0);
	});

	it("ranks plain ids above long variants without hiding matches", async () => {
		// Catalog order groups by provider: 30 regional bedrock variants first,
		// then the plain anthropic id.
		const variants: [string, string][] = Array.from({ length: 30 }, (_, i) => [
			"amazon-bedrock",
			`global.anthropic.claude-opus-4-${i}-20251101-v1:0`,
		]);
		const ui = createScriptedQuickUI({ input: () => "opus", select: () => "claude-opus-4-5" });

		const model = await acquireOneModel(ui, target, {
			enrich: { catalog: { anthropic: { "claude-opus-4-5": { id: "claude-opus-4-5" } } } },
			discover: async () => [],
			searchCatalog: catalogHits(...variants, ["anthropic", "claude-opus-4-5"]),
		});

		expect(model).toMatchObject({ id: "claude-opus-4-5" });
		const choices = ui.calls.find((c) => c.kind === "select")?.choices ?? [];
		// The plain id outranks every long variant despite coming last in catalog order.
		expect(choices[0]).toBe("claude-opus-4-5");
		// Every distinct match remains available, plus the literal escape hatch.
		expect(choices).toHaveLength(32);
		expect(ui.notifies.some((n) => n.message.includes("showing the closest"))).toBe(false);
	});

	it("falls back to the typed text when the catalog search throws", async () => {
		const ui = createScriptedQuickUI({ input: () => "whatever" });
		const model = await acquireOneModel(ui, target, {
			...NO_CATALOG,
			discover: async () => [],
			searchCatalog: async () => {
				throw new Error("catalog down");
			},
		});

		expect(model).toMatchObject({ id: "whatever" });
	});
});

import { describe, expect, it } from "vitest";
import { createScriptedQuickUI } from "./quick-adapter.js";
import { runAddProviderFlow } from "./quick-add-provider.js";
import type { ModelsJson } from "../models-json.js";

const NO_CATALOG = { catalog: null };

/**
 * Answer each prompt by message substring exactly once; every repeat (and any
 * unlisted prompt) returns null, so a rejected answer ends the flow instead of
 * spinning the re-ask loop forever.
 */
function scripted(answers: Record<string, string | null>) {
	const remaining = new Map(Object.entries(answers));
	const pick = (message: string): string | null => {
		for (const [needle, value] of remaining) {
			if (message.includes(needle)) {
				remaining.delete(needle);
				return value;
			}
		}
		return null;
	};
	return createScriptedQuickUI({ input: pick, select: pick });
}

const HAPPY_PATH = {
	"Provider key": "relay",
	"Base URL": "https://relay.test/v1",
	"API format": "openai-completions",
	"API key": "sk-user-secret",
	"Select model": "upstream-b",
};

// Hermetic: no official catalog, no catalog search hits.
const upstream = {
	enrich: NO_CATALOG,
	searchCatalog: async () => [],
	discover: async () => ["upstream-a", "upstream-b"],
};

describe("runAddProviderFlow", () => {
	const empty: ModelsJson = { providers: {} };

	it("walks one straight line and returns a single-model provider", async () => {
		const ui = scripted(HAPPY_PATH);
		const result = await runAddProviderFlow(ui, empty, upstream);

		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") return;
		expect(result.models.providers?.relay).toMatchObject({
			baseUrl: "https://relay.test/v1",
			api: "openai-completions",
			apiKey: "sk-user-secret",
			models: [{ id: "upstream-b" }],
		});

		// No mode selector and no "what next?" loop: exactly two selects.
		const selects = ui.calls.filter((c) => c.kind === "select").map((c) => c.message);
		expect(selects).toEqual(["API format:", "Select model:"]);
	});

	it("escapes Pi config metacharacters before discovery and persistence", async () => {
		let discoveredKey: string | undefined;
		const ui = scripted({ ...HAPPY_PATH, "API key": "!literal$HOME" });
		const result = await runAddProviderFlow(ui, empty, {
			...upstream,
			discover: async (provider) => {
				discoveredKey = provider.apiKey;
				return ["upstream-b"];
			},
		});

		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") return;
		expect(discoveredKey).toBe("$!literal$$HOME");
		expect(result.models.providers?.relay?.apiKey).toBe("$!literal$$HOME");
	});

	it("asks for the api key before listing upstream models", async () => {
		const ui = scripted(HAPPY_PATH);
		await runAddProviderFlow(ui, empty, upstream);

		const order = ui.calls.map((c) => c.message);
		expect(order.findIndex((m) => m.includes("API key"))).toBeLessThan(
			order.findIndex((m) => m.includes("Select model")),
		);
	});

	it("falls back to a typed model id when the provider has no /models", async () => {
		const ui = scripted({ ...HAPPY_PATH, "Model id": "hand-typed" });
		const result = await runAddProviderFlow(ui, empty, { ...upstream, discover: async () => [] });

		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") return;
		// No official catalog match: keep the model minimal and report it.
		expect(result.models.providers?.relay?.models).toEqual([{ id: "hand-typed", api: "openai-completions" }]);
		expect(ui.notifies.some((n) => n.level === "warning" && n.message.includes("minimal model entry"))).toBe(true);
	});

	it("rejects a provider key that already exists", async () => {
		const existing: ModelsJson = { providers: { relay: { baseUrl: "https://old.test", api: "openai-completions" } } };
		const ui = scripted(HAPPY_PATH);
		const result = await runAddProviderFlow(ui, existing, upstream);

		// The key prompt re-asks, gets the same answer, and Esc is never reached,
		// so the flow must not fall through to a write.
		expect(result.kind).toBe("cancelled");
		expect(ui.notifies.some((n) => n.message.includes("already exists"))).toBe(true);
	});

	it.each([
		["Provider key", {}],
		["Base URL", { "Provider key": "relay" }],
		["API format", { "Provider key": "relay", "Base URL": "https://relay.test/v1" }],
		["API key", { "Provider key": "relay", "Base URL": "https://relay.test/v1", "API format": "openai-completions" }],
	])("writes nothing when Esc is pressed at %s", async (_step, answers) => {
		const ui = scripted(answers as Record<string, string>);
		const result = await runAddProviderFlow(ui, empty, upstream);

		expect(result).toEqual({ kind: "cancelled" });
	});

	it("writes nothing when Esc is pressed at the model selection", async () => {
		const ui = scripted({ ...HAPPY_PATH, "Select model": null });
		const result = await runAddProviderFlow(ui, empty, upstream);

		expect(result).toEqual({ kind: "cancelled" });
	});

	it("rejects a base URL that is not http(s)", async () => {
		const ui = scripted({ ...HAPPY_PATH, "Base URL": "ftp://relay.test" });
		const result = await runAddProviderFlow(ui, empty, upstream);

		expect(result.kind).toBe("cancelled");
		expect(ui.notifies.some((n) => n.message.includes("http or https"))).toBe(true);
	});

	it("rejects a base URL carrying credentials", async () => {
		const ui = scripted({ ...HAPPY_PATH, "Base URL": "https://user:pw@relay.test/v1" });
		const result = await runAddProviderFlow(ui, empty, upstream);

		expect(result.kind).toBe("cancelled");
		expect(ui.notifies.some((n) => n.message.includes("username or password"))).toBe(true);
	});
});

import { describe, expect, it } from "vitest";
import { createScriptedQuickUI } from "./quick-adapter.js";
import { runAddModelFlow } from "./quick-add-model.js";
import type { ModelsJson } from "../models-json.js";

// Hermetic: no official catalog, no catalog search hits.
const upstream = {
	enrich: { catalog: null },
	searchCatalog: async () => [],
	discover: async () => ["upstream-a", "upstream-b"],
};

function models(): ModelsJson {
	return {
		providers: {
			relay: {
				baseUrl: "https://relay.test/v1",
				api: "openai-completions",
				apiKey: "sk-user-secret",
				models: [{ id: "existing-model", name: "Existing" }],
			},
		},
	};
}

describe("runAddModelFlow", () => {
	it("adds exactly one model and stops", async () => {
		const ui = createScriptedQuickUI({ select: () => "upstream-a" });
		const result = await runAddModelFlow(ui, "relay", models(), undefined, upstream);

		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") return;
		expect(result.models.providers?.relay?.models?.map((m) => m.id)).toEqual(["existing-model", "upstream-a"]);

		// One select for the model, no "add another" loop.
		expect(ui.calls.filter((c) => c.kind === "select")).toHaveLength(1);
	});

	it("asks before replacing an existing model id", async () => {
		const ui = createScriptedQuickUI({ select: () => "existing-model", confirm: () => true });
		const result = await runAddModelFlow(ui, "relay", models(), undefined, {
			...upstream,
			discover: async () => ["existing-model"],
		});

		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") return;
		expect(result.models.providers?.relay?.models).toHaveLength(1);
		expect(ui.calls.some((c) => c.kind === "confirm")).toBe(true);
	});

	it("writes nothing when the replace confirmation is declined", async () => {
		const ui = createScriptedQuickUI({ select: () => "existing-model", confirm: () => false });
		const result = await runAddModelFlow(ui, "relay", models(), undefined, {
			...upstream,
			discover: async () => ["existing-model"],
		});

		expect(result).toEqual({ kind: "cancelled" });
	});

	it("writes nothing when the model selection is escaped", async () => {
		const ui = createScriptedQuickUI({ select: () => null });
		const result = await runAddModelFlow(ui, "relay", models(), undefined, upstream);

		expect(result).toEqual({ kind: "cancelled" });
	});

	it("refuses a provider without a base URL", async () => {
		const broken: ModelsJson = { providers: { relay: { api: "openai-completions" } } };
		const ui = createScriptedQuickUI({});
		const result = await runAddModelFlow(ui, "relay", broken, undefined, upstream);

		expect(result).toEqual({ kind: "cancelled" });
		expect(ui.notifies.some((n) => n.message.includes("no base URL"))).toBe(true);
	});

	it("inherits the provider api when the model has none", async () => {
		const ui = createScriptedQuickUI({ select: () => "upstream-a" });
		const result = await runAddModelFlow(ui, "relay", models(), undefined, upstream);

		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") return;
		const added = result.models.providers?.relay?.models?.find((m) => m.id === "upstream-a");
		expect(added?.api).toBe("openai-completions");
	});
});

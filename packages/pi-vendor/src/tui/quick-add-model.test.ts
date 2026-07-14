import { describe, expect, it } from "vitest";
import { runAddModelFlow } from "./quick-add-model.js";
import { createScriptedQuickUI } from "./quick-adapter.js";
import type { ModelsJson } from "../models-json.js";

function makeModels(providers?: Record<string, any>): ModelsJson {
	return { providers: providers ?? {} };
}

describe("runAddModelFlow", () => {
	it("cancels when source selection returns null", async () => {
		const ui = createScriptedQuickUI({
			select: (_msg) => null, // Esc at source selection
		});

		const result = await runAddModelFlow(ui, "openai", makeModels());
		expect(result.kind).toBe("cancelled");
	});

	it("adds model via custom id and saves", async () => {
		const ui = createScriptedQuickUI({
			select: (msg) => {
				if (msg.includes("How would you like")) return "custom";
				if (msg.includes("What next")) return "save";
				return null;
			},
			input: (msg) => {
				if (msg.includes("Enter model id")) return "my-model";
				return null;
			},
		});

		const result = await runAddModelFlow(ui, "openai", makeModels({
			openai: { baseUrl: "https://api.openai.com/v1" },
		}));

		expect(result.kind).toBe("saved");
		if (result.kind === "saved") {
			expect(result.models.providers?.openai?.models).toHaveLength(1);
			expect(result.models.providers?.openai?.models?.[0]?.id).toBe("my-model");
		}
	});

	it("cancels at summary without writing", async () => {
		const ui = createScriptedQuickUI({
			select: (msg) => {
				if (msg.includes("How would you like")) return "custom";
				if (msg.includes("What next")) return "cancel";
				return null;
			},
			input: (msg) => {
				if (msg.includes("Enter model id")) return "my-model";
				return null;
			},
		});

		const result = await runAddModelFlow(ui, "openai", makeModels({
			openai: { baseUrl: "https://api.openai.com/v1" },
		}));

		expect(result.kind).toBe("cancelled");
	});

	it("adds another then saves (single commit with two models)", async () => {
		let addAnotherCalled = false;
		const ui = createScriptedQuickUI({
			select: (msg) => {
				if (msg.includes("How would you like")) return "custom";
				if (msg.includes("What next")) {
					if (!addAnotherCalled) {
						addAnotherCalled = true;
						return "add-another";
					}
					return "save";
				}
				return null;
			},
			input: (msg) => {
				if (msg.includes("Enter model id")) {
					return addAnotherCalled ? "model-2" : "model-1";
				}
				return null;
			},
		});

		const result = await runAddModelFlow(ui, "openai", makeModels({
			openai: { baseUrl: "https://api.openai.com/v1" },
		}));

		expect(result.kind).toBe("saved");
		if (result.kind === "saved") {
			expect(result.models.providers?.openai?.models).toHaveLength(2);
			expect(result.models.providers?.openai?.models?.[0]?.id).toBe("model-1");
			expect(result.models.providers?.openai?.models?.[1]?.id).toBe("model-2");
		}
	});

	it("handles model_exists conflict with explicit confirmation", async () => {
		let confirmCalled = false;
		const ui = createScriptedQuickUI({
			select: (msg) => {
				if (msg.includes("How would you like")) return "custom";
				if (msg.includes("What next")) return "save";
				return null;
			},
			input: (_msg) => "existing-model",
			confirm: (msg) => {
				if (msg.includes("already exists")) {
					confirmCalled = true;
					return true;
				}
				return false;
			},
		});

		const result = await runAddModelFlow(ui, "openai", makeModels({
			openai: {
				baseUrl: "https://api.openai.com/v1",
				models: [{ id: "existing-model", name: "Old" }],
			},
		}));

		expect(confirmCalled).toBe(true);
		expect(result.kind).toBe("saved");
		if (result.kind === "saved") {
			expect(result.models.providers?.openai?.models).toHaveLength(1);
			expect(result.models.providers?.openai?.models?.[0]?.id).toBe("existing-model");
		}
	});

	it("handles model_exists conflict rejection (goes back)", async () => {
		let confirmCount = 0;
		const ui = createScriptedQuickUI({
			select: (msg) => {
				if (msg.includes("How would you like")) {
					if (confirmCount === 0) return "custom";
					// After rejection, select source again and cancel
					return null;
				}
				if (msg.includes("What next")) return "save";
				return null;
			},
			input: (_msg) => "existing-model",
			confirm: (msg) => {
				if (msg.includes("already exists")) {
					confirmCount++;
					return false; // reject
				}
				return false;
			},
		});

		const result = await runAddModelFlow(ui, "openai", makeModels({
			openai: {
				baseUrl: "https://api.openai.com/v1",
				models: [{ id: "existing-model" }],
			},
		}));

		expect(confirmCount).toBe(1);
		expect(result.kind).toBe("cancelled");
	});

	it("handles empty input by going back", async () => {
		let sourceCalls = 0;
		const ui = createScriptedQuickUI({
			select: (msg) => {
				if (msg.includes("How would you like")) {
					sourceCalls++;
					return sourceCalls === 1 ? "custom" : null; // second call cancels
				}
				if (msg.includes("What next")) return "save";
				return null;
			},
			input: (_msg) => "   ",
		});

		const result = await runAddModelFlow(ui, "openai", makeModels({
			openai: { baseUrl: "https://api.openai.com/v1" },
		}));

		// Goes back to source selection, which cancels on second null
		expect(result.kind).toBe("cancelled");
	});
});

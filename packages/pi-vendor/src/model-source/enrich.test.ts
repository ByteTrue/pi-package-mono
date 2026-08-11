import { describe, expect, it } from "vitest";

import { enrichModelId } from "./enrich.js";

describe("model enrichment", () => {
	it("requires confirmation even with single official candidate", async () => {
		const result = await enrichModelId("gpt-4o", {
			catalog: {
				openai: {
					"gpt-4o": {
						id: "gpt-4o",
						name: "Official GPT-4o",
						api: "openai-completions",
						provider: "openai",
						baseUrl: "https://api.openai.com/v1",
						contextWindow: 128000,
						maxTokens: 16384,
						compat: { supportsReasoningEffort: true },
					},
				},
			},
		});

		// Even with a single candidate, should require user confirmation
		expect(result).toMatchObject({
			kind: "official-ambiguous",
			modelId: "gpt-4o",
		});
		if (result.kind === "official-ambiguous") {
			expect(result.candidates).toHaveLength(1);
			expect(result.candidates[0]).toMatchObject({
				provider: "openai",
				model: {
					id: "gpt-4o",
					name: "Official GPT-4o",
					api: "openai-completions",
					contextWindow: 128000,
					maxTokens: 16384,
				},
			});
		}
	});

	it("reports official ambiguity with multiple candidates", async () => {
		const result = await enrichModelId("gpt-4o", {
			catalog: {
				openai: {
					"gpt-4o": { id: "gpt-4o", name: "A" },
				},
				openrouter: {
					"gpt-4o": { id: "gpt-4o", name: "B" },
				},
			},
		});

		expect(result).toMatchObject({ kind: "official-ambiguous", modelId: "gpt-4o" });
		if (result.kind === "official-ambiguous") {
			expect(result.candidates).toHaveLength(2);
		}
	});

	it("uses a minimal entry when the official catalog has no match", async () => {
		const result = await enrichModelId("mystery-model", { catalog: null });
		expect(result).toMatchObject({
			kind: "ready",
			warning: expect.stringContaining("mystery-model"),
			model: { id: "mystery-model" },
		});
		if (result.kind === "ready") expect(result.model).toEqual({ id: "mystery-model" });
	});
});

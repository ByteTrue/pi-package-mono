import { describe, expect, it } from "vitest";

import { enrichModelId } from "./enrich.js";

describe("model enrichment", () => {
	it("uses official catalog metadata before fallback templates", async () => {
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
			templates: [
				{
					id: "gpt-4o",
					name: "Template GPT-4o",
					contextWindow: 1,
					maxTokens: 1,
					input: ["text"],
				},
			],
		});

		expect(result).toMatchObject({
			kind: "ready",
			source: "official",
			model: {
				id: "gpt-4o",
				name: "Official GPT-4o",
				api: "openai-completions",
				contextWindow: 128000,
				maxTokens: 16384,
				compat: { supportsReasoningEffort: true },
			},
		});
		expect(result.kind).toBe("ready");
		if (result.kind === "ready") {
			expect(result.model).not.toHaveProperty("provider");
			expect(result.model).not.toHaveProperty("baseUrl");
		}
	});

	it("reports official ambiguity instead of guessing", async () => {
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

	it("prefers the longest template prefix and falls back to safe defaults", async () => {
		const prefixed = await enrichModelId("gpt-4.1-mini", {
			catalog: null,
			templates: [
				{ prefix: "gpt", name: "GPT family", contextWindow: 1, maxTokens: 1 },
				{ prefix: "gpt-4.1", name: "GPT-4.1 family", reasoning: true, input: ["text", "image"], contextWindow: 2, maxTokens: 2 },
			],
		});

		expect(prefixed).toMatchObject({
			kind: "ready",
			source: "template",
			model: {
				id: "gpt-4.1-mini",
				name: "GPT-4.1 family",
				reasoning: true,
				input: ["text", "image"],
				contextWindow: 2,
				maxTokens: 2,
			},
		});

		const unknown = await enrichModelId("mystery-model", { catalog: null, templates: [] });
		expect(unknown).toMatchObject({
			kind: "ready",
			source: "default",
			warning: expect.stringContaining("mystery-model"),
			model: {
				id: "mystery-model",
				name: "mystery-model",
				reasoning: false,
				input: ["text"],
				contextWindow: 128000,
				maxTokens: 16384,
			},
		});
	});
});

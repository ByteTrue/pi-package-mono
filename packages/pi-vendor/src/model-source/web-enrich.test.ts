import { describe, expect, it } from "vitest";
import { enrichModelForWeb, enrichModelForTui } from "./web-enrich.js";

describe("enrichModelForWeb", () => {
	it("returns official-candidates with closed DTOs", async () => {
		const result = await enrichModelForWeb("gpt-4o", {
			catalog: {
				openai: {
					"gpt-4o": {
						id: "gpt-4o",
						name: "GPT-4o",
						api: "openai-completions",
						baseUrl: "https://api.openai.com/v1",
						apiKey: "sk-secret",
						authHeader: true,
						headers: { Authorization: "Bearer x" },
						provider: "openai",
						contextWindow: 128000,
						maxTokens: 16384,
						compat: { supportsReasoningEffort: true },
					},
				},
			},
		});

		expect(result.kind).toBe("official-candidates");
		if (result.kind === "official-candidates") {
			expect(result.candidates).toHaveLength(1);
			const candidate = result.candidates[0]!;
			expect(candidate.provider).toBe("openai");
			expect(candidate.modelId).toBe("gpt-4o");
			expect(candidate.model).not.toHaveProperty("apiKey");
			expect(candidate.model).not.toHaveProperty("baseUrl");
			expect(candidate.model).not.toHaveProperty("headers");
			expect(candidate.model).not.toHaveProperty("authHeader");
			expect(candidate.model).not.toHaveProperty("provider");
			expect(candidate.model.name).toBe("GPT-4o");
			expect(candidate.model.compat!.supportsReasoningEffort).toBe(true);
		}
	});

	it("returns ready with template source and closed DTO", async () => {
		const result = await enrichModelForWeb("gpt-4.1-mini", {
			catalog: null,
			templates: [
				{ prefix: "gpt-4.1", name: "GPT-4.1 family", reasoning: true, input: ["text", "image"], contextWindow: 2, maxTokens: 2 },
			],
		});

		expect(result).toMatchObject({
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
		if (result.kind !== "ready") throw new Error("expected ready");
		expect(result.model).not.toHaveProperty("apiKey");
		expect(result.model).not.toHaveProperty("baseUrl");
	});

	it("returns ready with default source for unknown model", async () => {
		const result = await enrichModelForWeb("mystery-model", { catalog: null, templates: [] });
		expect(result).toMatchObject({
			kind: "ready",
			source: "default",
			model: { id: "mystery-model" },
		});
		if (result.kind !== "ready") throw new Error("expected ready");
		expect(result.warning).toBeDefined();
	});

	it("returns multiple candidates when multiple providers have the same model", async () => {
		const result = await enrichModelForWeb("gpt-4o", {
			catalog: {
				openai: { "gpt-4o": { id: "gpt-4o", name: "A" } },
				openrouter: { "gpt-4o": { id: "gpt-4o", name: "B" } },
			},
		});

		expect(result.kind).toBe("official-candidates");
		if (result.kind === "official-candidates") {
			expect(result.candidates).toHaveLength(2);
		}
	});

	it("falls back to default when no candidates produce valid DTOs", async () => {
		const result = await enrichModelForWeb("bad-model", {
		// deno-lint-ignore no-explicit-any
		catalog: {
			test: {
				"bad-model": { name: "No ID" } as any,
			},
		},
	});

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") throw new Error("expected ready");
		expect(result.source).toBe("default");
	});
});

describe("enrichModelForTui", () => {
	it("returns raw enrichment result (pass-through)", async () => {
		const result = await enrichModelForTui("gpt-4o", {
			catalog: {
				openai: {
					"gpt-4o": {
						id: "gpt-4o",
						name: "GPT-4o",
						api: "openai-completions",
						baseUrl: "https://api.openai.com/v1",
						apiKey: "sk-secret",
						provider: "openai",
						contextWindow: 128000,
						maxTokens: 16384,
					},
				},
			},
		});

		expect(result.kind).toBe("official-ambiguous");
		if (result.kind === "official-ambiguous") {
			expect(result.candidates[0]!.model.baseUrl).toBe("https://api.openai.com/v1");
			expect(result.candidates[0]!.model.apiKey).toBe("sk-secret");
		}
	});
});

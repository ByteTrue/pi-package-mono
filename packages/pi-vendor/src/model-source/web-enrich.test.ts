import { describe, expect, it } from "vitest";
import { enrichModelForTui } from "./web-enrich.js";

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

import { describe, expect, it } from "vitest";

import { createDefaultModelConfig, createTemplateModelConfig, matchTemplate, type ModelTemplate } from "./templates.js";

describe("template matching", () => {
	it("prefers exact matches over prefixes", () => {
		const templates: ModelTemplate[] = [
			{ prefix: "gpt-4", name: "GPT-4 family" },
			{ id: "gpt-4o", name: "GPT-4o exact", reasoning: true, input: ["text", "image"] },
		];
		expect(matchTemplate("gpt-4o", templates)).toMatchObject({ id: "gpt-4o", name: "GPT-4o exact" });
	});

	it("uses the longest matching prefix", () => {
		const templates: ModelTemplate[] = [
			{ prefix: "gpt-4", name: "GPT-4 family" },
			{ prefix: "gpt-4.1", name: "GPT-4.1 family" },
			{ prefix: "gpt", name: "GPT family" },
		];
		expect(matchTemplate("gpt-4.1-mini", templates)).toMatchObject({ prefix: "gpt-4.1", name: "GPT-4.1 family" });
	});

	it("builds safe default configs", () => {
		expect(createDefaultModelConfig("mystery")).toMatchObject({
			id: "mystery",
			name: "mystery",
			reasoning: false,
			input: ["text"],
			contextWindow: 128000,
			maxTokens: 16384,
		});
	});

	it("carries template metadata into a model config", () => {
		expect(
			createTemplateModelConfig("custom", {
				name: "Custom",
				reasoning: true,
				input: ["text", "image"],
				contextWindow: 200000,
				maxTokens: 4096,
				compat: { supportsDeveloperRole: false },
			}),
		).toMatchObject({
			id: "custom",
			name: "Custom",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 4096,
			compat: { supportsDeveloperRole: false },
		});
	});
});

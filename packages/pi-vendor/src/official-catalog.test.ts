import { describe, expect, it } from "vitest";

import { collectOfficialCandidates, formatOfficialCandidate, stripOfficialRoutingFields } from "./official-catalog.js";

describe("official catalog helpers", () => {
	it("returns every exact model-id candidate across providers", () => {
		const catalog = {
			openai: {
				"gpt-4o": {
					id: "gpt-4o",
					name: "GPT-4o",
					api: "openai-completions",
					provider: "openai",
					baseUrl: "https://api.openai.com/v1",
					headers: { Authorization: "Bearer x" },
					apiKey: "x",
					authHeader: true,
					contextWindow: 128000,
					maxTokens: 16384,
					compat: { supportsReasoningEffort: true },
				},
			},
			openrouter: {
				"gpt-4o": {
					id: "gpt-4o",
					name: "GPT-4o Router",
					api: "openai-responses",
					provider: "openrouter",
					baseUrl: "https://openrouter.ai/api/v1",
					contextWindow: 128000,
					maxTokens: 8192,
				},
			},
		};

		const candidates = collectOfficialCandidates(catalog, "gpt-4o");
		expect(candidates).toHaveLength(2);
		expect(formatOfficialCandidate(candidates[0]!)).toMatch(/gpt-4o/);
	});

	it("keeps non-routing metadata when stripping official fields", () => {
		const config = stripOfficialRoutingFields({
			id: "gpt-4o",
			name: "GPT-4o",
			api: "openai-completions",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			headers: { Authorization: "Bearer x" },
			apiKey: "x",
			authHeader: true,
			contextWindow: 128000,
			maxTokens: 16384,
			compat: { supportsReasoningEffort: true },
		});

		expect(config).toMatchObject({
			id: "gpt-4o",
			name: "GPT-4o",
			api: "openai-completions",
			contextWindow: 128000,
			maxTokens: 16384,
			compat: { supportsReasoningEffort: true },
		});
		expect(config).not.toHaveProperty("provider");
		expect(config).not.toHaveProperty("baseUrl");
		expect(config).not.toHaveProperty("headers");
		expect(config).not.toHaveProperty("apiKey");
		expect(config).not.toHaveProperty("authHeader");
	});
});

import { describe, expect, it } from "vitest";
import { toCatalogModelTemplate } from "./catalog-model-dto.js";

describe("toCatalogModelTemplate closed mapper", () => {
	it("returns minimal config for an id-only object", () => {
		expect(toCatalogModelTemplate({ id: "gpt-4o" })).toMatchObject({ id: "gpt-4o" });
	});

	it("returns undefined when id is missing", () => {
		expect(toCatalogModelTemplate({})).toBeUndefined();
		expect(toCatalogModelTemplate({ name: "no-id" })).toBeUndefined();
	});

	it("strips routing fields: provider, baseUrl, headers, apiKey, authHeader", () => {
		const config = toCatalogModelTemplate({
			id: "claude",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com/v1",
			headers: { Authorization: "Bearer secret" },
			apiKey: "sk-secret",
			authHeader: true,
			name: "Claude",
		});
		expect(config).toBeDefined();
		expect(config!).not.toHaveProperty("provider");
		expect(config!).not.toHaveProperty("baseUrl");
		expect(config!).not.toHaveProperty("headers");
		expect(config!).not.toHaveProperty("apiKey");
		expect(config!).not.toHaveProperty("authHeader");
		expect(config!.name).toBe("Claude");
	});

	it("fails loudly on unknown top-level fields", () => {
		expect(() => toCatalogModelTemplate({ id: "test", futureField: true }))
			.toThrow("model.futureField");
	});

	it("fails loudly on unknown compat fields", () => {
		expect(() => toCatalogModelTemplate({
			id: "test",
			compat: { supportsReasoningEffort: true, futureCompat: true },
		})).toThrow("compat.futureCompat");
	});

	it("preserves current Pi 0.82 compat fields", () => {
		const config = toCatalogModelTemplate({
			id: "test",
			compat: {
				supportsStrictTools: true,
				supportsOpenAIGrammarTools: true,
				supportsToolSearch: true,
				supportsExplicitPromptCacheMode: true,
				deferredToolsMode: "kimi",
				sessionAffinityFormat: "openrouter",
			},
		});
		expect(config!.compat).toEqual({
			supportsStrictTools: true,
			supportsOpenAIGrammarTools: true,
			supportsToolSearch: true,
			supportsExplicitPromptCacheMode: true,
			deferredToolsMode: "kimi",
			sessionAffinityFormat: "openrouter",
		});
	});

	it("preserves characterized-safe fields: cost.tiers, zaiToolStream, supportsTemperature, allowEmptySignature", () => {
		const config = toCatalogModelTemplate({
			id: "test",
			cost: {
				input: 3,
				output: 15,
				cacheRead: 0.3,
				cacheWrite: 3.75,
				tiers: [
					{ inputTokensAbove: 200000, input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 },
				],
			},
			compat: {
				zaiToolStream: true,
				supportsTemperature: false,
				allowEmptySignature: true,
			},
		});
		expect(config!.cost).toMatchObject({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
		expect(config!.cost!.tiers).toHaveLength(1);
		expect(config!.cost!.tiers![0]).toMatchObject({ inputTokensAbove: 200000, input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 });
		expect(config!.compat!.zaiToolStream).toBe(true);
		expect(config!.compat!.supportsTemperature).toBe(false);
		expect(config!.compat!.allowEmptySignature).toBe(true);
	});

	it("preserves safe compat fields and validates enum types", () => {
		const config = toCatalogModelTemplate({
			id: "test",
			compat: {
				supportsStore: true,
				supportsDeveloperRole: false,
				maxTokensField: "max_completion_tokens",
				thinkingFormat: "openai",
				cacheControlFormat: "anthropic",
				supportsStrictMode: true,
				supportsEagerToolInputStreaming: true,
				sendSessionAffinityHeaders: true,
				forceAdaptiveThinking: false,
			},
		});
		expect(config!.compat!.supportsStore).toBe(true);
		expect(config!.compat!.supportsDeveloperRole).toBe(false);
		expect(config!.compat!.maxTokensField).toBe("max_completion_tokens");
		expect(config!.compat!.thinkingFormat).toBe("openai");
		expect(config!.compat!.cacheControlFormat).toBe("anthropic");
		expect(config!.compat!.supportsStrictMode).toBe(true);
		expect(config!.compat!.supportsEagerToolInputStreaming).toBe(true);
		expect(config!.compat!.sendSessionAffinityHeaders).toBe(true);
		expect(config!.compat!.forceAdaptiveThinking).toBe(false);
	});

	it("rejects invalid enum values", () => {
		const config = toCatalogModelTemplate({
			id: "test",
			compat: {
				maxTokensField: "bogus",
				thinkingFormat: "invalid-format",
				cacheControlFormat: "not-anthropic",
			},
		});
		// Compat object should be undefined since no valid fields
		expect(config!.compat).toBeUndefined();
	});

	it("maps chatTemplateKwargs with safe values", () => {
		const config = toCatalogModelTemplate({
			id: "test",
			compat: {
				chatTemplateKwargs: {
					enabled: { $var: "thinking.enabled" },
					effort: { $var: "thinking.effort", omitWhenOff: true },
					literal: "hello",
					num: 42,
					flag: true,
					none: null,
				},
			},
		});
		expect(config!.compat!.chatTemplateKwargs).toMatchObject({
			enabled: { $var: "thinking.enabled" },
			effort: { $var: "thinking.effort", omitWhenOff: true },
			literal: "hello",
			num: 42,
			flag: true,
			none: null,
		});
	});

	it("fails loudly when a chatTemplateKwarg has an unsupported shape", () => {
		expect(() => toCatalogModelTemplate({
			id: "test",
			compat: {
				chatTemplateKwargs: {
					badVar: { $var: "unknown.var" },
				},
			},
		})).toThrow("compat.chatTemplateKwargs.badVar");
	});

	it("maps known thinking levels and fails loudly on unknown ones", () => {
		const config = toCatalogModelTemplate({
			id: "test",
			thinkingLevelMap: {
				off: "disabled",
				low: null,
				medium: "balanced",
			},
		});
		expect(config!.thinkingLevelMap).toMatchObject({
			off: "disabled",
			low: null,
			medium: "balanced",
		});
		expect(() => toCatalogModelTemplate({ id: "test", thinkingLevelMap: { future: "value" } }))
			.toThrow("thinkingLevelMap.future");
	});

	it("serializes to JSON without forbidden routing keys", () => {
		const config = toCatalogModelTemplate({
			id: "gpt-4o",
			apiKey: "sk-secret",
			headers: { Authorization: "Bearer x" },
			baseUrl: "https://api.openai.com/v1",
			provider: "openai",
			authHeader: true,
			name: "GPT-4o",
			cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
			compat: {
				supportsReasoningEffort: true,
				zaiToolStream: true,
			},
		});
		const json = JSON.stringify(config);
		const forbidden = ["apiKey", "baseUrl", "headers", "authHeader", "provider"];
		for (const key of forbidden) {
			expect(json).not.toContain(`"${key}"`);
		}
		expect(json).toContain("GPT-4o");
		expect(json).toContain("supportsReasoningEffort");
		expect(json).toContain("zaiToolStream");
	});
});

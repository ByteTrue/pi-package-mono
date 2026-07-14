import { describe, expect, it } from "vitest";
import { toWebModelConfig } from "./web-model-dto.js";

describe("toWebModelConfig closed mapper", () => {
	it("returns minimal config for an id-only object", () => {
		expect(toWebModelConfig({ id: "gpt-4o" })).toMatchObject({ id: "gpt-4o" });
	});

	it("returns undefined when id is missing", () => {
		expect(toWebModelConfig({})).toBeUndefined();
		expect(toWebModelConfig({ name: "no-id" })).toBeUndefined();
	});

	it("strips routing fields: provider, baseUrl, headers, apiKey, authHeader", () => {
		const config = toWebModelConfig({
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

	it("strips unknown top-level fields", () => {
		const config = toWebModelConfig({
			id: "test",
			unknownField: "secret",
			routing: { foo: "bar" },
			nestedArray: [1, 2, 3],
		});
		expect(config).toBeDefined();
		expect(config!).not.toHaveProperty("unknownField");
		expect(config!).not.toHaveProperty("routing");
		expect(config!).not.toHaveProperty("nestedArray");
	});

	it("strips unknown compat fields", () => {
		const config = toWebModelConfig({
			id: "test",
			compat: {
				supportsReasoningEffort: true,
				openRouterRouting: { model: "openai/gpt-4o" },
				vercelGatewayRouting: { model: "gpt-4o" },
				unknownCompat: "danger",
			},
		});
		expect(config!.compat).toBeDefined();
		expect(config!.compat!.supportsReasoningEffort).toBe(true);
		expect(config!.compat).not.toHaveProperty("openRouterRouting");
		expect(config!.compat).not.toHaveProperty("vercelGatewayRouting");
		expect(config!.compat).not.toHaveProperty("unknownCompat");
	});

	it("preserves characterized-safe fields: cost.tiers, zaiToolStream, supportsTemperature, allowEmptySignature", () => {
		const config = toWebModelConfig({
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
		const config = toWebModelConfig({
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
		const config = toWebModelConfig({
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
		const config = toWebModelConfig({
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

	it("returns undefined compat when all chatTemplateKwargs are invalid", () => {
		const config = toWebModelConfig({
			id: "test",
			compat: {
				chatTemplateKwargs: {
					badVar: { $var: "unknown.var" },
					extraKeys: { $var: "thinking.enabled", unknownKey: true },
					noVar: {},
					wrongType: { $var: 123 },
				},
			},
		});
		// compat itself is undefined when all fields are rejected
		expect(config!.compat).toBeUndefined();
	});

	it("maps thinkingLevelMap with known levels", () => {
		const config = toWebModelConfig({
			id: "test",
			thinkingLevelMap: {
				off: "disabled",
				low: null,
				medium: "balanced",
				unknown: "should-be-stripped",
			},
		});
		expect(config!.thinkingLevelMap).toMatchObject({
			off: "disabled",
			low: null,
			medium: "balanced",
		});
		expect(config!.thinkingLevelMap).not.toHaveProperty("unknown");
	});

	it("serializes to JSON without forbidden keys (recursive scan)", () => {
		const config = toWebModelConfig({
			id: "gpt-4o",
			apiKey: "sk-secret",
			headers: { Authorization: "Bearer x" },
			baseUrl: "https://api.openai.com/v1",
			provider: "openai",
			authHeader: true,
			openRouterRouting: { model: "openai/gpt-4o" },
			name: "GPT-4o",
			cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5, unknownCost: "x" },
			compat: {
				supportsReasoningEffort: true,
				zaiToolStream: true,
				openRouterRouting: { model: "x" },
				vercelGatewayRouting: { model: "y" },
			},
		});
		const json = JSON.stringify(config);
		const forbidden = ["apiKey", "baseUrl", "headers", "authHeader", "provider",
			"openRouterRouting", "vercelGatewayRouting", "unknownCost"];
		for (const key of forbidden) {
			expect(json).not.toContain(`"${key}"`);
		}
		expect(json).toContain("GPT-4o");
		expect(json).toContain("supportsReasoningEffort");
		expect(json).toContain("zaiToolStream");
	});
});

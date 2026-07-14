import { afterEach, describe, expect, it, vi } from "vitest";

import { buildOpenAIModelsUrl, fetchOpenAIModelIds, parseOpenAIModelsResponse, resolveApiKeyValue } from "./openai-models.js";

afterEach(() => vi.unstubAllEnvs());

describe("openai model helpers", () => {
	it("builds /models URLs without dropping the base path", () => {
		expect(buildOpenAIModelsUrl("https://example.com/v1")).toBe("https://example.com/v1/models");
		expect(buildOpenAIModelsUrl("https://example.com/custom/api")).toBe("https://example.com/custom/api/models");
	});

	it("resolves api keys from env references and literals", () => {
		vi.stubEnv("OPENAI_API_KEY", "secret");
		expect(resolveApiKeyValue("$OPENAI_API_KEY")).toEqual({ value: "secret", source: "env" });
		expect(resolveApiKeyValue("literal-key")).toEqual({ value: "literal-key", source: "literal" });
	});

	it("throws clearly for an unresolved env reference", () => {
		expect(() => resolveApiKeyValue("$MISSING_KEY", {})).toThrow(/Environment variable MISSING_KEY is not set/);
	});

	it("parses OpenAI-compatible responses and dedupes ids", () => {
		expect(parseOpenAIModelsResponse({ data: [{ id: "b" }, { id: "a" }, { id: "b" }, { id: 1 }, {}] })).toEqual(["a", "b"]);
	});

	it("fetches ids with a resolved env reference", async () => {
		vi.stubEnv("OPENAI_API_KEY", "secret");
		const fetchImpl = vi.fn(async (input: string, init?: { method?: string; headers?: Record<string, string> }) => {
			expect(input).toBe("https://example.com/v1/models");
			expect(init?.method).toBe("GET");
			expect(init?.headers?.Authorization).toBe("Bearer secret");
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => ({ data: [{ id: "z" }, { id: "a" }, { id: "z" }] }),
			};
		});

		await expect(fetchOpenAIModelIds({ baseUrl: "https://example.com/v1", apiKey: "$OPENAI_API_KEY" }, fetchImpl)).resolves.toEqual(["a", "z"]);
	});

	it("fails clearly when the env reference is unresolved during fetch", async () => {
		await expect(fetchOpenAIModelIds({ baseUrl: "https://example.com/v1", apiKey: "$MISSING_KEY" }, vi.fn())).rejects.toThrow(
			/Environment variable MISSING_KEY is not set/,
		);
	});
});

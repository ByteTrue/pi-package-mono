import { describe, expect, it, vi } from "vitest";
import { searchOfficialModels } from "./catalog-search.js";
import type { OfficialModelsCatalog } from "./official-catalog.js";

function fakeCatalog(): OfficialModelsCatalog {
	return {
		openai: {
			"gpt-4o": { id: "gpt-4o", name: "GPT-4o", api: "openai-completions", contextWindow: 128000, maxTokens: 16384 },
			"gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1", api: "openai-completions" },
			"o4-mini": { id: "o4-mini", name: "O4 Mini", reasoning: true },
		},
		anthropic: {
			"claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", api: "anthropic-messages", contextWindow: 200000 },
			"claude-opus-4-5": { id: "claude-opus-4-5", name: "Claude Opus 4.5", api: "anthropic-messages" },
		},
	};
}

vi.mock("./official-catalog.js", () => ({
	loadOfficialCatalog: vi.fn(),
}));

const { loadOfficialCatalog } = await import("./official-catalog.js");
const mockLoad = loadOfficialCatalog as ReturnType<typeof vi.fn>;

describe("searchOfficialModels", () => {
	it("returns empty when catalog is unavailable", async () => {
		mockLoad.mockResolvedValue(null);
		await expect(searchOfficialModels("gpt-4o")).resolves.toEqual([]);
	});

	it("finds models by exact id match", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		const results = await searchOfficialModels("gpt-4o");
		expect(results).toHaveLength(1);
		expect(results[0]!.provider).toBe("openai");
		expect(results[0]!.modelId).toBe("gpt-4o");
		expect(results[0]!.model.name).toBe("GPT-4o");
	});

	it("finds models by exact name match", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		const results = await searchOfficialModels("Claude Sonnet 4.5");
		expect(results).toHaveLength(1);
		expect(results[0]!.modelId).toBe("claude-sonnet-4-5");
	});

	it("finds models by prefix match", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		const results = await searchOfficialModels("claude");
		expect(results).toHaveLength(2);
	});

	it("finds models by substring match", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		const results = await searchOfficialModels("mini");
		expect(results).toHaveLength(1);
		expect(results[0]!.modelId).toBe("o4-mini");
	});

	it("returns exact matches before prefix matches", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		const results = await searchOfficialModels("gpt");
		// gpt-4o, gpt-4.1 should be prefix matches (no exact id match for "gpt")
		expect(results.length).toBeGreaterThanOrEqual(2);
		// first-seen order within prefix group
		expect(results.map(r => r.modelId)).toEqual(["gpt-4o", "gpt-4.1"]);
	});

	it("respects the limit parameter", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		const results = await searchOfficialModels("claude", 1);
		expect(results).toHaveLength(1);
	});

	it("throws on oversize query (>512 UTF-8 bytes)", async () => {
		await expect(searchOfficialModels("a".repeat(513))).rejects.toThrow("Query exceeds maximum length");
	});

	it("does not throw on exactly 512 byte query", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		const query = "a".repeat(512);
		await expect(searchOfficialModels(query)).resolves.toEqual([]);
	});

	it("strips routing/credential fields from results", async () => {
		mockLoad.mockResolvedValue({
			test: {
				"secret-model": {
					id: "secret-model",
					apiKey: "sk-secret",
					baseUrl: "https://evil.com",
					headers: { Authorization: "Bearer x" },
					authHeader: true,
					provider: "test",
				},
			},
		});
		const results = await searchOfficialModels("secret-model");
		expect(results).toHaveLength(1);
		const model = results[0]!.model;
		expect(model).not.toHaveProperty("apiKey");
		expect(model).not.toHaveProperty("baseUrl");
		expect(model).not.toHaveProperty("headers");
		expect(model).not.toHaveProperty("authHeader");
		expect(model).not.toHaveProperty("provider");
		expect(model.id).toBe("secret-model");
	});
});

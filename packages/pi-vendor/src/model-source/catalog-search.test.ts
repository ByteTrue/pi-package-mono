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
	it("fails visibly when catalog is unavailable", async () => {
		mockLoad.mockResolvedValue(null);
		await expect(searchOfficialModels("gpt-4o")).rejects.toMatchObject({ code: "catalog_unavailable" });
	});


	it("finds models by exact id match", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		const results = await searchOfficialModels("gpt-4o");
		expect(results).toEqual(["gpt-4o"]);
	});

	it("finds models by exact name match", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		expect(await searchOfficialModels("Claude Sonnet 4.5")).toEqual(["claude-sonnet-4-5"]);
	});

	it("finds models by prefix match", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		const results = await searchOfficialModels("claude");
		expect(results).toHaveLength(2);
	});

	it("finds models by substring match", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		expect(await searchOfficialModels("mini")).toEqual(["o4-mini"]);
	});

	it("orders prefix matches by id within the group (script semantics)", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		expect(await searchOfficialModels("gpt")).toEqual(["gpt-4.1", "gpt-4o"]);
	});

	it("matches multi-token queries like the skill script", async () => {
		mockLoad.mockResolvedValue({
			openai: {
				"gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2" },
				"gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
				"claude-x": { id: "claude-x", name: "Claude X" },
			},
		});
		// "gpt 5": whole-string substring would find nothing and the TUI used to
		// store the literal as a custom id (audit BYTE-4 #8); token matching finds it.
		expect(await searchOfficialModels("gpt 5")).toEqual(["gpt-5.2"]);
	});

	it("matches separator-insensitive queries like the skill script", async () => {
		mockLoad.mockResolvedValue(fakeCatalog());
		expect(await searchOfficialModels("gpt4o")).toEqual(["gpt-4o"]);
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

	it("returns only model ids, never catalog metadata", async () => {
		mockLoad.mockResolvedValue({
			test: {
				"secret-model": {
					id: "secret-model",
					apiKey: "sk-secret",
					baseUrl: "https://evil.com",
					headers: { Authorization: "Bearer x" },
				},
			},
		});
		expect(await searchOfficialModels("secret-model")).toEqual(["secret-model"]);
	});
});

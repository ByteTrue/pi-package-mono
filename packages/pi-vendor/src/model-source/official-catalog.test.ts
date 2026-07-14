import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectOfficialCandidates, findOfficialCatalogPath, formatOfficialCandidate, groupOfficialModelsById, stripOfficialRoutingFields } from "./official-catalog.js";

describe("official catalog helpers", () => {

	it("uses the first active Pi root's generated catalog", () => {
		const firstRoot = mkdtempSync(join(tmpdir(), "pi-vendor-catalog-first-"));
		const secondRoot = mkdtempSync(join(tmpdir(), "pi-vendor-catalog-second-"));
		const catalogPath = join(firstRoot, "node_modules/@earendil-works/pi-ai/dist/models.generated.js");
		try {
			mkdirSync(join(firstRoot, "node_modules/@earendil-works/pi-ai/dist"), { recursive: true });
			mkdirSync(join(secondRoot, "node_modules/@earendil-works/pi-ai/dist"), { recursive: true });
			writeFileSync(catalogPath, "export const MODELS = {};\n");
			writeFileSync(join(secondRoot, "node_modules/@earendil-works/pi-ai/dist/models.generated.js"), "export const MODELS = {};\n");

			expect(findOfficialCatalogPath([firstRoot, secondRoot])).toBe(catalogPath);
		} finally {
			rmSync(firstRoot, { recursive: true, force: true });
			rmSync(secondRoot, { recursive: true, force: true });
		}
	});
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

	it("groups official entries by model id while preserving first-seen order", () => {
		const groups = groupOfficialModelsById([
			{ provider: "anthropic", modelId: "claude-sonnet-4-5", model: { id: "claude-sonnet-4-5" } },
			{ provider: "cloudflare", modelId: "claude-sonnet-4-5", model: { id: "claude-sonnet-4-5" } },
			{ provider: "anthropic", modelId: "claude-sonnet-4-6", model: { id: "claude-sonnet-4-6" } },
		]);

		expect(groups.map((group) => group.modelId)).toEqual(["claude-sonnet-4-5", "claude-sonnet-4-6"]);
		expect(groups[0]?.entries.map((entry) => entry.provider)).toEqual(["anthropic", "cloudflare"]);
	});
});

import { describe, expect, it, vi } from "vitest";
import { runAddProviderFlow } from "./quick-add-provider.js";
import { createScriptedQuickUI } from "./quick-adapter.js";
import * as catalogSearch from "../model-source/catalog-search.js";
import * as webEnrich from "../model-source/web-enrich.js";
import * as boundedDiscover from "../model-source/bounded-discover.js";
import type { ModelsJson } from "../models-json.js";

vi.mock("../model-source/catalog-search.js");
vi.mock("../model-source/web-enrich.js");
vi.mock("../model-source/bounded-discover.js");

function makeModels(providers?: Record<string, unknown>): ModelsJson {
	return { providers: providers as ModelsJson["providers"] };
}

describe("runAddProviderFlow", () => {
	it("cancels when provider key input is null (Esc)", async () => {
		const ui = createScriptedQuickUI({
			input: (_msg) => null,
		});
		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("cancelled");
	});

	it("cancels when baseUrl input is null (Esc)", async () => {
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				return null; // Esc at baseUrl
			},
		});
		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("cancelled");
	});

	it("cancels when api format select is null (Esc)", async () => {
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.example.com/v1";
				return null;
			},
			select: (_msg) => null, // Esc at api format
		});
		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("cancelled");
	});

	it("cancels when apiKey input is null (Esc)", async () => {
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.example.com/v1";
				if (msg.includes("API key")) return null;
				return null;
			},
			select: (_msg) => "openai-completions",
		});
		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("cancelled");
	});

	it("rejects existing provider key", async () => {
		let keyAttempts = 0;
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) {
					keyAttempts++;
					if (keyAttempts === 1) return "existing";
					return null; // Esc after error notification
				}
				return null;
			},
		});
		const result = await runAddProviderFlow(ui, makeModels({
			existing: { baseUrl: "https://example.com" },
		}));
		expect(result.kind).toBe("cancelled");
		// Should show error notification
		expect(ui.notifies.some((n) => n.message.includes("already exists"))).toBe(true);
	});

	it("rejects empty provider key with warning and retries", async () => {
		let keyCalls = 0;
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) {
					keyCalls++;
					if (keyCalls === 1) return "   "; // whitespace only
					if (keyCalls === 2) return "valid-key";
					return null;
				}
				if (msg.includes("Base URL")) return "https://api.example.com/v1";
			if (msg.includes("API key")) return "sk-test";
			if (msg.includes("Search")) return "gpt-4o";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "openai-completions";
				if (msg.includes("How would you like")) return "catalog";
				if (msg.includes("What next")) return "save";
				return null;
			},
		});

		vi.mocked(catalogSearch.searchOfficialModels).mockResolvedValue([]);
		vi.mocked(webEnrich.enrichModelForTui).mockResolvedValue({
			kind: "ready",
			model: { id: "gpt-4o", name: "GPT-4o" },
		} as any);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("saved");
		expect(ui.notifies.some((n) => n.message.includes("cannot be empty"))).toBe(true);
	});

	it("rejects invalid baseUrl", async () => {
		let urlCalls = 0;
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) {
					urlCalls++;
					if (urlCalls === 1) return "not-a-url";
					if (urlCalls === 2) return "ftp://bad.com";
					if (urlCalls === 3) return "https://user:pass@example.com";
					return "https://api.example.com/v1";
				}
				if (msg.includes("API key")) return "sk-test";
				if (msg.includes("Search")) return "gpt-4o";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "openai-completions";
				if (msg.includes("How would you like")) return "catalog";
				if (msg.includes("What next")) return "save";
				return null;
			},
		});

		vi.mocked(catalogSearch.searchOfficialModels).mockResolvedValue([]);
		vi.mocked(webEnrich.enrichModelForTui).mockResolvedValue({
			kind: "ready",
			model: { id: "gpt-4o" },
		} as any);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("saved");
		// Should have seen error notifications for bad URLs
		const errorNotifies = ui.notifies.filter((n) => n.level === "error");
		expect(errorNotifies.length).toBeGreaterThanOrEqual(2); // not-a-url + ftp + userinfo
	});

	it("saves minimal provider with catalog model", async () => {
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.example.com/v1";
				if (msg.includes("API key")) return "sk-test";
				if (msg.includes("Search")) return "gpt-4o";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "openai-completions";
				if (msg.includes("How would you like")) return "catalog";
				if (msg.includes("Select model")) return "gpt-4o";
				if (msg.includes("What next")) return "save";
				return null;
			},
		});

		vi.mocked(catalogSearch.searchOfficialModels).mockResolvedValue([{
			provider: "openai",
			modelId: "gpt-4o",
			model: { id: "gpt-4o", name: "GPT-4o", api: "openai-completions" },
		} as any]);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") throw new Error("unexpected");
		expect(result.models.providers).toBeDefined();
		expect(result.models.providers!["my-provider"]).toBeDefined();
		const provider = result.models.providers!["my-provider"]!;
		expect(provider.baseUrl).toBe("https://api.example.com/v1");
		expect(provider.api).toBe("openai-completions");
		expect(provider.apiKey).toBe("sk-test");
		expect(provider.models).toHaveLength(1);
		expect(provider.models![0]!.id).toBe("gpt-4o");
	});

	it("saves with custom api format and custom model id", async () => {
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.anthropic.com/v1";
				if (msg.includes("Custom API")) return "anthropic-messages";
				if (msg.includes("API key")) return "sk-ant-test";
				if (msg.includes("Enter model id")) return "claude-sonnet-4-5";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "_custom";
				if (msg.includes("How would you like")) return "custom";
				if (msg.includes("What next")) return "save";
				return null;
			},
		});

		vi.mocked(webEnrich.enrichModelForTui).mockResolvedValue({
			kind: "ready",
			model: { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
		} as any);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") throw new Error("unexpected");
		const provider = result.models.providers!["my-provider"]!;
		expect(provider.api).toBe("anthropic-messages");
		expect(provider.models![0]!.id).toBe("claude-sonnet-4-5");
	});

	it("imports models via discoverModelIds for non-command provider", async () => {
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.example.com/v1";
				if (msg.includes("API key")) return "sk-test";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "openai-completions";
				if (msg.includes("How would you like")) return "import";
				if (msg.includes("Select one to import")) return "model-a";
				if (msg.includes("What next")) return "save";
				return null;
			},
		});

		vi.mocked(boundedDiscover.discoverModelIds).mockResolvedValue(["model-a", "model-b", "model-c"]);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") throw new Error("unexpected");
		const provider = result.models.providers!["my-provider"]!;
		expect(provider.models![0]!.id).toBe("model-a");
	});

	it("does not offer import for command-backed apiKey", async () => {
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.example.com/v1";
				if (msg.includes("API key")) return "!get-api-key my-provider";
				if (msg.includes("Search")) return "gpt-4o";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "openai-completions";
				if (msg.includes("How would you like")) return "catalog";
				if (msg.includes("Select model")) return "gpt-4o";
				if (msg.includes("What next")) return "save";
				return null;
			},
		});

		vi.mocked(catalogSearch.searchOfficialModels).mockResolvedValue([{
			provider: "openai",
			modelId: "gpt-4o",
			model: { id: "gpt-4o", name: "GPT-4o" },
		} as any]);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") throw new Error("unexpected");
		// Verify import was never offered — no "Import from" in select messages
		const selectMessages = ui.calls.filter((c) => c.kind === "select").map((c) => c.message);
		expect(selectMessages.some((m) => m.includes("Import"))).toBe(false);
	});

	it("cancels at summary without writing", async () => {
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.example.com/v1";
				if (msg.includes("API key")) return "sk-test";
				if (msg.includes("Search")) return "gpt-4o";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "openai-completions";
				if (msg.includes("How would you like")) return "catalog";
				if (msg.includes("Select model")) return "gpt-4o";
				if (msg.includes("What next")) return "cancel";
				return null;
			},
		});

		vi.mocked(catalogSearch.searchOfficialModels).mockResolvedValue([{
			provider: "openai",
			modelId: "gpt-4o",
			model: { id: "gpt-4o", name: "GPT-4o" },
		} as any]);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("cancelled");
	});

	it("add another model accumulates", async () => {
		let modelRound = 0;
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.example.com/v1";
				if (msg.includes("API key")) return "sk-test";
				if (msg.includes("Search")) return modelRound === 0 ? "gpt-4o" : "gpt-4o-mini";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "openai-completions";
				if (msg.includes("How would you like")) return "catalog";
				if (msg.includes("Select model")) return modelRound === 0 ? "gpt-4o" : "gpt-4o-mini";
				if (msg.includes("What next")) {
					modelRound++;
					if (modelRound === 1) return "add-another";
					return "save";
				}
				return null;
			},
		});

		vi.mocked(catalogSearch.searchOfficialModels).mockResolvedValue([
			{ provider: "openai", modelId: "gpt-4o", model: { id: "gpt-4o", name: "GPT-4o" } } as any,
			{ provider: "openai", modelId: "gpt-4o-mini", model: { id: "gpt-4o-mini", name: "GPT-4o Mini" } } as any,
		]);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") throw new Error("unexpected");
		// Both models accumulated across add-another
		const provider = result.models.providers!["my-provider"]!;
		expect(provider.models).toHaveLength(2);
		expect(provider.models!.map((m) => m.id)).toEqual(["gpt-4o", "gpt-4o-mini"]);
		expect(modelRound).toBe(2);
	});


	it("handles empty model discovery with warning", async () => {
		let importAttempted = false;
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.example.com/v1";
				if (msg.includes("API key")) return "sk-test";
				if (msg.includes("Search")) return "gpt-4o";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "openai-completions";
				if (msg.includes("How would you like")) {
					if (!importAttempted) {
						importAttempted = true;
						return "import";
					}
					return "catalog";
				}
				if (msg.includes("Select model")) return "gpt-4o";
				if (msg.includes("What next")) return "save";
				return null;
			},
		});

		vi.mocked(boundedDiscover.discoverModelIds).mockResolvedValue([]);
		vi.mocked(catalogSearch.searchOfficialModels).mockResolvedValue([{
			provider: "openai",
			modelId: "gpt-4o",
			model: { id: "gpt-4o", name: "GPT-4o" },
		} as any]);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("saved");
		expect(ui.notifies.some((n) => n.message.includes("No models found"))).toBe(true);
	});

	it("inherits provider api when model api is missing", async () => {
		const ui = createScriptedQuickUI({
			input: (msg) => {
				if (msg.includes("Provider key")) return "my-provider";
				if (msg.includes("Base URL")) return "https://api.anthropic.com/v1";
				if (msg.includes("API key")) return "sk-test";
				if (msg.includes("Enter model id")) return "claude-sonnet";
				return null;
			},
			select: (msg) => {
				if (msg.includes("API format")) return "anthropic-messages";
				if (msg.includes("How would you like")) return "custom";
				if (msg.includes("What next")) return "save";
				return null;
			},
		});

		vi.mocked(webEnrich.enrichModelForTui).mockResolvedValue({
			kind: "ready",
			model: { id: "claude-sonnet" }, // no api
		} as any);

		const result = await runAddProviderFlow(ui, makeModels());
		expect(result.kind).toBe("saved");
		if (result.kind !== "saved") throw new Error("unexpected");
		const provider = result.models.providers!["my-provider"]!;
		expect(provider.models![0]!.api).toBe("anthropic-messages");
	});
});

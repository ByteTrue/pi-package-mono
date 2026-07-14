// Quick add-provider flow for /vendor TUI.
// Implements roadmap §4.7: minimal provider key/baseUrl/api/apiKey/first-model flow.

import type { ModelsJson, ProviderConfig } from "../models-json.js";
import { createProvider } from "../config-document.js";
import { discoverModelIds } from "../model-source/bounded-discover.js";
import { enrichModelForTui } from "../model-source/web-enrich.js";
import { searchOfficialModels } from "../model-source/catalog-search.js";
import type { OfficialModelChoice } from "../model-source/web-model-dto.js";
import type { ProviderModelConfig } from "../models-json.js";
import type { QuickUI } from "./quick-adapter.js";

export type AddProviderResult =
	| { kind: "saved"; models: ModelsJson }
	| { kind: "cancelled" };

const API_CHOICES = [
	{ value: "openai-completions" as const, label: "OpenAI Completions" },
	{ value: "openai-responses" as const, label: "OpenAI Responses" },
	{ value: "anthropic-messages" as const, label: "Anthropic Messages" },
	{ value: "google-generative-ai" as const, label: "Google Generative AI" },
	{ value: "_custom" as const, label: "Custom…" },
];

async function acquireProviderKey(ui: QuickUI, models: ModelsJson): Promise<string | null> {
	for (;;) {
		const key = await ui.input({ message: "Provider key (unique name):" });
		if (key === null) return null;
		const trimmed = key.trim();
		if (!trimmed) {
			ui.notify("Provider key cannot be empty.", "warning");
			continue;
		}
		if (trimmed in (models.providers ?? {})) {
			ui.notify(`Provider "${trimmed}" already exists. Choose a different key.`, "error");
			continue;
		}
		return trimmed;
	}
}

async function acquireBaseUrl(ui: QuickUI): Promise<string | null> {
	for (;;) {
		const input = await ui.input({
			message: "Base URL:",
			placeholder: "https://api.example.com/v1",
		});
		if (input === null) return null;
		const trimmed = input.trim();
		if (!trimmed) {
			ui.notify("Base URL cannot be empty.", "warning");
			continue;
		}
		let url: URL;
		try {
			url = new URL(trimmed);
		} catch {
			ui.notify("Invalid URL. Must be a valid http or https address.", "error");
			continue;
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			ui.notify("URL must use http or https.", "error");
			continue;
		}
		if (url.username || url.password) {
			ui.notify("URL must not contain username or password.", "error");
			continue;
		}
		return trimmed;
	}
}

async function acquireApiFormat(ui: QuickUI): Promise<string | null> {
	const choice = await ui.select({
		message: "API format:",
		choices: API_CHOICES.map((c) => ({ value: c.value, label: c.label })),
		default: "openai-completions",
	});
	if (choice === null) return null;
	if (choice === "_custom") {
		const custom = await ui.input({ message: "Custom API format:" });
		if (custom === null) return null;
		const trimmed = custom.trim();
		if (!trimmed) return "openai-completions";
		return trimmed;
	}
	return choice;
}

async function acquireApiKey(ui: QuickUI): Promise<string | null> {
	for (;;) {
		const key = await ui.input({ message: "API key (required):" });
		if (key === null) return null;
		if (!key.trim()) {
			ui.notify("API key cannot be empty.", "warning");
			continue;
		}
		return key;
	}
}

type ProviderDraftFields = {
	key: string;
	baseUrl: string;
	api: string;
	apiKey: string;
};

function isCommandBacked(value: string): boolean {
	return value.startsWith("!");
}

type ModelAcquireResult =
	| { kind: "model"; model: ProviderModelConfig }
	| { kind: "cancelled" }
	| null; // null = go back

async function acquireFirstModel(
	ui: QuickUI,
	draft: ProviderDraftFields,
): Promise<ModelAcquireResult> {
	const commandRestricted = isCommandBacked(draft.apiKey);

	const sourceChoices: { value: string; label: string }[] = [
		{ value: "catalog", label: "Search or enter model id" },
		{ value: "custom", label: "Enter custom id" },
	];

	if (!commandRestricted) {
		sourceChoices.push({ value: "import", label: "Import from /models" });
	}

	const source = await ui.select({
		message: "How would you like to add the first model?",
		choices: sourceChoices as { value: string; label: string }[],
		default: "catalog",
	});
	if (source === null) return null;

	switch (source) {
		case "catalog":
			return acquireFromCatalog(ui);
		case "custom":
			return acquireCustom(ui);
		case "import":
			return acquireFromImport(ui, draft);
		default:
			return null;
	}
}

async function acquireFromCatalog(ui: QuickUI): Promise<ModelAcquireResult> {
	const query = await ui.input({
		message: "Search official model catalog or enter custom id:",
		placeholder: "e.g. gpt-4o, claude-sonnet-4-5, or custom-id",
	});
	if (!query) return { kind: "cancelled" };

	const trimmed = query.trim();
	if (!trimmed) return null;

	const results = await searchOfficialModels(trimmed, 25);

	if (results.length > 0) {
		const providers = new Set(results.map((r) => r.provider));
		if (providers.size > 1) {
			const providerChoice = await ui.select({
				message: `Multiple providers found for "${trimmed}". Select source:`,
				choices: [...providers].map((p) => ({ value: p, label: p })),
			});
			if (!providerChoice) return { kind: "cancelled" };
			const filtered = results.filter((r) => r.provider === providerChoice);
			if (filtered.length > 0) return buildModelFromChoice(filtered[0]!);
		}

		const selected = await ui.select({
			message: "Select model:",
			choices: results.map((r) => ({
				value: r.modelId,
				label: `${r.provider}/${r.modelId}${r.model.name ? ` - ${r.model.name}` : ""}`,
			})),
		});
		if (!selected) return { kind: "cancelled" };
		const choice = results.find((r) => r.modelId === selected);
		if (choice) return buildModelFromChoice(choice);
	}

	// No catalog results — treat as custom id with enrichment
	const enriched = await enrichModelForTui(trimmed);
	if (enriched.kind === "official-ambiguous") {
		ui.notify(`No catalog entries found for "${trimmed}". Using defaults.`, "warning");
		return { kind: "model", model: { id: trimmed } };
	}

	return { kind: "model", model: enriched.model };
}

function buildModelFromChoice(choice: OfficialModelChoice): ModelAcquireResult {
	const model: ProviderModelConfig = {
		id: choice.model.id,
		name: choice.model.name,
		api: choice.model.api,
		reasoning: choice.model.reasoning,
		thinkingLevelMap: choice.model.thinkingLevelMap,
		input: choice.model.input,
		// ponytail: skip cost field mapping, add when ProviderModelConfig supports WebCost
		contextWindow: choice.model.contextWindow,
		maxTokens: choice.model.maxTokens,
		compat: choice.model.compat as ProviderModelConfig["compat"],
	};
	return { kind: "model", model };
}

async function acquireCustom(ui: QuickUI): Promise<ModelAcquireResult> {
	const id = await ui.input({
		message: "Enter model id:",
		placeholder: "e.g. my-custom-model",
	});
	if (!id) return { kind: "cancelled" };

	const trimmed = id.trim();
	if (!trimmed) return null;

	const enriched = await enrichModelForTui(trimmed);
	if (enriched.kind === "official-ambiguous") {
		ui.notify(`Using default configuration for "${trimmed}".`, "info");
	}

	if (enriched.kind === "ready") {
		return { kind: "model", model: enriched.model };
	}

	return { kind: "model", model: { id: trimmed } };
}

async function acquireFromImport(
	ui: QuickUI,
	draft: ProviderDraftFields,
): Promise<ModelAcquireResult> {
	// For new providers, call discoverModelIds directly with draft config
	const providerConfig = {
		baseUrl: draft.baseUrl,
		apiKey: draft.apiKey,
		headers: undefined as Record<string, string> | undefined,
	};

	ui.notify("Discovering models...", "info");

	let ids: string[];
	try {
		ids = await discoverModelIds(providerConfig, {});
	} catch (err) {
		ui.notify(`Failed to discover models: ${err instanceof Error ? err.message : String(err)}`, "error");
		return null;
	}

	if (ids.length === 0) {
		ui.notify("No models found at the provider's /models endpoint.", "warning");
		return null;
	}

	const selected = await ui.select({
		message: `Found ${ids.length} models. Select one to import:`,
		choices: ids.slice(0, 100).map((id) => ({ value: id, label: id })),
	});
	if (!selected) return { kind: "cancelled" };

	return { kind: "model", model: { id: selected } };
}

export async function runAddProviderFlow(ui: QuickUI, models: ModelsJson): Promise<AddProviderResult> {
	// Step 1: Provider key (must be unique)
	const key = await acquireProviderKey(ui, models);
	if (key === null) return { kind: "cancelled" };

	// Step 2: Base URL
	const baseUrl = await acquireBaseUrl(ui);
	if (baseUrl === null) return { kind: "cancelled" };

	// Step 3: API format
	const api = await acquireApiFormat(ui);
	if (api === null) return { kind: "cancelled" };

	// Step 4: API key
	const apiKey = await acquireApiKey(ui);
	if (apiKey === null) return { kind: "cancelled" };

	const draft: ProviderDraftFields = { key, baseUrl, api, apiKey };

	// Step 5: First model — loop until save or cancel
	// Accumulate models across add-another; save once with all models.
	let accumulatedModels: ProviderModelConfig[] = [];
	for (;;) {
		const modelResult = await acquireFirstModel(ui, draft);
		if (modelResult === null) continue; // back to model source
		if (modelResult.kind === "cancelled") continue;

		// Inherit provider api if model api is missing
		if (!modelResult.model.api) {
			modelResult.model = { ...modelResult.model, api: draft.api };
		}

		accumulatedModels = [...accumulatedModels, modelResult.model];

		// Build provider with all accumulated models
		const providerConfig: ProviderConfig = {
			baseUrl: draft.baseUrl,
			api: draft.api,
			apiKey: draft.apiKey,
			models: accumulatedModels,
		};

		const draftModels = { ...models, providers: { ...(models.providers ?? {}) } };
		const createResult = createProvider(draftModels, draft.key, providerConfig);
		if (!createResult.ok) {
			ui.notify(`Cannot create provider: ${createResult.error.message}`, "error");
			accumulatedModels = accumulatedModels.slice(0, -1); // rollback duplicate addition
			continue;
		}

		// Summary
		const modelList = accumulatedModels.map((m) => m.id).join(", ");
		const summary = await ui.select({
			message: `Provider "${draft.key}" with ${accumulatedModels.length} model(s): ${modelList}. What next?`,
			choices: [
				{ value: "save", label: "Save" },
				{ value: "add-another", label: "Add another model" },
				{ value: "cancel", label: "Cancel" },
			],
			default: "save",
		});
		if (summary === null || summary === "cancel") return { kind: "cancelled" };
		if (summary === "add-another") continue;

		return { kind: "saved", models: createResult.value };
	}
}

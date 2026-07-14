// Quick add-model flow for /vendor TUI.
// Implements roadmap §4.7: catalog search, custom id, /models import,
// enrichment, conflict resolution, and summary.

import type { ModelsJson, ProviderModelConfig } from "../models-json.js";
import { addModel, replaceModel } from "../config-document.js";
import { searchOfficialModels } from "../model-source/catalog-search.js";
import { enrichModelForTui } from "../model-source/web-enrich.js";
import { discoverModelIds } from "../model-source/bounded-discover.js";
import type { OfficialModelChoice } from "../model-source/web-model-dto.js";
import type { QuickUI } from "./quick-adapter.js";

export type AddModelResult =
	| { kind: "saved"; models: ModelsJson }
	| { kind: "cancelled" };

export type ModelSource = "catalog" | "custom" | "import";

/**
 * Run the add-model quick flow for an existing provider.
 *
 * Steps:
 * 1. Let user choose source: catalog, custom, or import
 * 2. Based on source: search/select official model, enter custom id, or import from /models
 * 3. Show model summary: Save, Add another, Cancel
 * 4. On Save: commit the model
 * 5. On Add another: loop back to step 1
 * 6. On Cancel: no write
 */
export async function runAddModelFlow(
	ui: QuickUI,
	providerKey: string,
	models: ModelsJson,
	initialProvider?: { apiKey?: string; headers?: Record<string, string> },
): Promise<AddModelResult> {
	for (;;) {
		// Step 1: Choose source
		const source = await chooseModelSource(ui);
		if (!source) return { kind: "cancelled" };

		// Step 2: Get model config based on source
		const modelResult = await acquireModel(ui, source, models, initialProvider);
		if (!modelResult) continue; // back to source selection
		if (modelResult.kind === "cancelled") continue;

		// Step 3: Check for existing model conflict
		const existingModels = models.providers?.[providerKey]?.models ?? [];
		const existingIndex = existingModels.findIndex((m) => m.id === modelResult.model.id);

		if (existingIndex >= 0) {
			const confirmed = await ui.confirm(
				`Model "${modelResult.model.id}" already exists in ${providerKey}. Replace it?`,
				"The existing model configuration will be overwritten.",
			);
			if (!confirmed) continue;
			// Use replaceModel with overwrite-confirmed
			const result = replaceModel(models, providerKey, modelResult.model.id, modelResult.model, { conflict: "overwrite-confirmed" });
			if (!result.ok) {
				ui.notify(`Failed to replace model: ${result.error.message}`, "error");
				continue;
			}
			models = result.value;
		} else {
			const result = addModel(models, providerKey, modelResult.model);
			if (!result.ok) {
				ui.notify(`Failed to add model: ${result.error.message}`, "error");
				continue;
			}
			models = result.value;
		}

		// Step 4: Show summary
		const action = await ui.select({
			message: `Model "${modelResult.model.id}" added to ${providerKey}. What next?`,
			choices: [
				{ value: "save", label: "Save" },
				{ value: "add-another", label: "Add another" },
				{ value: "cancel", label: "Cancel" },
			],
			default: "save",
		});

		if (action === "save") {
			return { kind: "saved", models };
		}
		if (action === "cancel") {
			return { kind: "cancelled" };
		}
		// "add-another": loop back
	}
}

async function chooseModelSource(ui: QuickUI): Promise<ModelSource | null> {
	return ui.select<ModelSource>({
		message: "How would you like to add a model?",
		choices: [
			{ value: "catalog", label: "Search or enter model id" },
			{ value: "import", label: "Import from /models" },
			{ value: "custom", label: "Enter custom id" },
		],
		default: "catalog",
	});
}

type AcquireModelResult =
	| { kind: "model"; model: ProviderModelConfig }
	| { kind: "cancelled" }
	| null; // null = go back

export async function acquireModel(
	ui: QuickUI,
	source: ModelSource,
	models: ModelsJson,
	initialProvider?: { apiKey?: string; headers?: Record<string, string> },
): Promise<AcquireModelResult> {
	switch (source) {
		case "catalog":
			return acquireFromCatalog(ui, models);
		case "custom":
			return acquireCustom(ui);
		case "import":
			return acquireFromImport(ui, models, initialProvider);
	}
}

async function acquireFromCatalog(ui: QuickUI, models: ModelsJson): Promise<AcquireModelResult> {
	const query = await ui.input({
		message: "Search official model catalog or enter custom id:",
		placeholder: "e.g. gpt-4o, claude-sonnet-4-5, or custom-id",
	});
	if (!query) return { kind: "cancelled" };

	const trimmed = query.trim();
	if (!trimmed) return null;

	// Try catalog search
	const results = await searchOfficialModels(trimmed, 25);

	if (results.length > 0) {
		// Check for multi-provider ambiguity
		const providers = new Set(results.map((r) => r.provider));
		if (providers.size > 1) {
			// Show provider selection first
			const providerChoice = await ui.select({
				message: `Multiple providers found for "${trimmed}". Select source:`,
				choices: [...providers].map((p) => ({ value: p, label: p })),
			});
			if (!providerChoice) return { kind: "cancelled" };

			// Filter results to chosen provider
			const filtered = results.filter((r) => r.provider === providerChoice);
			if (filtered.length > 0) {
				return buildModelFromChoice(filtered[0]!, models);
			}
		}

		// Show model selection from results
		const choices = results.map((r) => ({
			value: r.modelId,
			label: `${r.provider}/${r.modelId}${r.model.name ? ` - ${r.model.name}` : ""}`,
		}));

		const selected = await ui.select({
			message: "Select model:",
			choices,
		});

		if (!selected) return { kind: "cancelled" };
		const choice = results.find((r) => r.modelId === selected);
		if (choice) return buildModelFromChoice(choice, models);
	}

	// No catalog results — treat as custom id with enrichment
	const enriched = await enrichModelForTui(trimmed);
	if (enriched.kind === "official-ambiguous") {
		// Shouldn't happen since catalog returned empty, but handle defensively
		ui.notify(`No catalog entries found for "${trimmed}". Using defaults.`, "warning");
		return {
			kind: "model",
			model: { id: trimmed },
		};
	}

	return {
		kind: "model",
		model: enriched.model,
	};
}

function buildModelFromChoice(choice: OfficialModelChoice, _models: ModelsJson): AcquireModelResult {
	// Build ProviderModelConfig from WebModelConfig
	const model: ProviderModelConfig = {
		id: choice.model.id,
		name: choice.model.name,
		api: choice.model.api,
		reasoning: choice.model.reasoning,
		thinkingLevelMap: choice.model.thinkingLevelMap,
		input: choice.model.input,
		// cost is omitted — WebCost doesn't match ProviderModelConfig Record<string, number>
		// ponytail: skip cost field mapping, add when ProviderModelConfig supports WebCost
		contextWindow: choice.model.contextWindow,
		maxTokens: choice.model.maxTokens,
		compat: choice.model.compat as ProviderModelConfig["compat"],
	};
	return { kind: "model", model };
}

async function acquireCustom(ui: QuickUI): Promise<AcquireModelResult> {
	const id = await ui.input({
		message: "Enter model id:",
		placeholder: "e.g. my-custom-model",
	});
	if (!id) return { kind: "cancelled" };

	const trimmed = id.trim();
	if (!trimmed) return null;

	const enriched = await enrichModelForTui(trimmed);
	if (enriched.kind === "official-ambiguous") {
		// Shouldn't happen with custom id, but enrichModelId always returns ambiguous
		// for catalog matches. For pure custom ids, it will be ready with default.
		ui.notify(`Using default configuration for "${trimmed}".`, "info");
	}

	if (enriched.kind === "ready") {
		return { kind: "model", model: enriched.model };
	}

	return {
		kind: "model",
		model: { id: trimmed },
	};
}

async function acquireFromImport(
	ui: QuickUI,
	models: ModelsJson,
	initialProvider?: { apiKey?: string; headers?: Record<string, string> },
): Promise<AcquireModelResult> {
	// Get existing provider keys
	const providerKeys = Object.keys(models.providers ?? {});
	if (providerKeys.length === 0) {
		ui.notify("No providers configured. Add a provider first.", "error");
		return null;
	}

	// Select provider to import for
	const providerKey = await ui.select({
		message: "Select provider to import models for:",
		choices: providerKeys.map((k) => ({ value: k, label: k })),
	});
	if (!providerKey) return { kind: "cancelled" };

	const provider = models.providers?.[providerKey];
	if (!provider || !provider.baseUrl) {
		ui.notify(`Provider "${providerKey}" has no base URL.`, "error");
		return null;
	}

	// Check if the provider has command credentials without an initialProvider
	const hasCommandApiKey = typeof provider.apiKey === "string" && provider.apiKey.startsWith("!");
	const hasCommandHeaders = Object.values(provider.headers ?? {}).some((v) => typeof v === "string" && v.startsWith("!"));

	if ((hasCommandApiKey || hasCommandHeaders) && !initialProvider) {
		ui.notify(
			`Provider "${providerKey}" uses command-based credentials. Import is not available for unsaved credentials.`,
			"error",
		);
		return null;
	}

	ui.notify("Discovering models...", "info");

	let ids: string[];
	try {
		ids = await discoverModelIds(
			provider as { baseUrl: string; apiKey?: string; headers?: Record<string, string> },
			{ initialProvider: initialProvider as { apiKey?: string; headers?: Record<string, string> } | undefined },
		);
	} catch (err) {
		ui.notify(`Failed to discover models: ${err instanceof Error ? err.message : String(err)}`, "error");
		return null;
	}

	if (ids.length === 0) {
		ui.notify("No models found at the provider's /models endpoint.", "warning");
		return null;
	}

	// Select model ids to import
	const selected = await ui.select({
		message: `Found ${ids.length} models. Select one to import:`,
		choices: ids.slice(0, 100).map((id) => ({ value: id, label: id })),
	});

	if (!selected) return { kind: "cancelled" };

	return {
		kind: "model",
		model: { id: selected },
	};
}

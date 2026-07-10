import { enrichModelId } from "./enrich.js";
import { fuzzyFilter } from "./fuzzy.js";
import { modelList, removeModelAtIndex, replaceModelAtIndex, upsertModel } from "./model-list.js";
import type { ProviderDraft, ProviderModelConfig } from "./models-json.js";
import {
	formatOfficialCandidate,
	groupOfficialModelsById,
	listAllOfficialModels,
	loadOfficialCatalog,
	stripOfficialRoutingFields,
} from "./official-catalog.js";
import { fetchOpenAIModelIds } from "./openai-models.js";
import { customInput, customSelect, selectValue } from "./vendor-ui.js";

const MODEL_MENU = {
	addManual: "Add manual model id",
	importModels: "Import from /models endpoint",
	remove: "Remove model",
	replace: "Replace/edit model JSON",
	preview: "Preview selected models",
	back: "Back to provider form",
} as const;

function modelLabel(index: number, model: ProviderModelConfig): string {
	const name = model.name?.trim();
	return `${index + 1}. ${model.id}${name && name !== model.id ? ` - ${name}` : ""}`;
}

async function previewModelsJson(ctx: any, models: ProviderModelConfig[]): Promise<void> {
	await ctx.ui.editor("Preview selected models", `${JSON.stringify(models, null, 2)}\n`);
}

async function selectOfficialCandidate(ctx: any, candidates: Array<{ provider: string; model: { id: string } }>): Promise<number | null> {
	const labels = candidates.map((candidate) => formatOfficialCandidate(candidate));
	const choice = await customSelect(ctx, `Choose an official config for ${candidates[0]?.model.id ?? "model"}`, labels);
	const value = selectValue(choice);
	if (value == null) return null;
	return labels.indexOf(value);
}

async function addEnrichedModel(ctx: any, draft: ProviderDraft, modelId: string): Promise<boolean> {
	const outcome = await enrichModelId(modelId);
	if (outcome.kind === "official-ambiguous") {
		const choice = await selectOfficialCandidate(ctx, outcome.candidates);
		if (choice == null) return false;
		const chosen = outcome.candidates[choice];
		if (!chosen) return false;
		draft.config.models = upsertModel(modelList(draft.config), stripOfficialRoutingFields(chosen.model));
		ctx.ui.notify(`Added ${chosen.model.id} from ${chosen.provider}`, "info");
		return true;
	}

	let model = outcome.model;
	if (outcome.source === "default") {
		const edited = await ctx.ui.editor(`Review model ${modelId}`, `${JSON.stringify(model, null, 2)}\n`);
		if (edited == null) return false;
		try {
			const parsed = JSON.parse(edited);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { id?: unknown }).id !== "string") {
				throw new Error("expected an object with a string id");
			}
			model = parsed as ProviderModelConfig;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Invalid model JSON: ${message}`, "error");
			return false;
		}
	}

	draft.config.models = upsertModel(modelList(draft.config), model);
	ctx.ui.notify(`Added ${model.id} from ${outcome.source}`, "info");
	return true;
}

async function addManualModel(ctx: any, draft: ProviderDraft): Promise<"done" | "back"> {
	// Load official catalog for fuzzy search
	const catalog = await loadOfficialCatalog();
	const allModels = listAllOfficialModels(catalog);

	// Fuzzy search loop
	for (;;) {
		const query = await customInput(ctx, "Search models", "Type to search official models (or press Enter to list all)");
		if (query == null) return "back";

		const filtered = fuzzyFilter(allModels, query, (entry) => entry.modelId);
		const groups = groupOfficialModelsById(filtered);

		if (groups.length === 0) {
			const choice = await customSelect(ctx, "No matching model ids", [
				"Enter custom model id...",
				"Search again",
				"Cancel",
			]);
			const value = selectValue(choice);
			if (value == null || value === "Search again") continue;
			if (value === "Cancel") return "back";
			if (value === "Enter custom model id...") {
				const customId = await customInput(ctx, "Custom model id", "Enter a model id, e.g. my-custom-model");
				if (customId == null) continue;
				if (!customId.trim()) continue;
				return await addEnrichedModel(ctx, draft, customId.trim()) ? "done" : "back";
			}
			continue;
		}

		const labels = groups.map((group) => group.modelId);
		const title = query.trim()
			? `Found ${groups.length} model id(s)`
			: `Official model ids (${groups.length})`;

		for (;;) {
			const choice = await customSelect(ctx, title, [
				...labels,
				"Enter custom model id...",
				"Search again",
				"Cancel",
			]);
			const value = selectValue(choice);
			if (value == null || value === "Search again") break;
			if (value === "Cancel") return "back";

			if (value === "Enter custom model id...") {
				const customId = await customInput(ctx, "Custom model id", "Enter a model id, e.g. my-custom-model");
				if (customId == null) continue;
				if (!customId.trim()) continue;
				return await addEnrichedModel(ctx, draft, customId.trim()) ? "done" : "back";
			}

			const selectedGroup = groups.find((group) => group.modelId === value);
			if (!selectedGroup) continue;

			const providerLabels = selectedGroup.entries.map((entry) => formatOfficialCandidate({ provider: entry.provider, model: entry.model }));
			const providerChoice = await customSelect(ctx, `Choose provider for ${selectedGroup.modelId}`, providerLabels);
			const providerValue = selectValue(providerChoice);
			if (providerValue == null) continue;

			const providerIndex = providerLabels.indexOf(providerValue);
			const selectedEntry = selectedGroup.entries[providerIndex];
			if (!selectedEntry) continue;

			draft.config.models = upsertModel(modelList(draft.config), stripOfficialRoutingFields(selectedEntry.model));
			ctx.ui.notify(`Added ${selectedEntry.model.id} from ${selectedEntry.provider}`, "info");
			return "done";
		}
	}
}

async function importFromOpenAIModels(ctx: any, draft: ProviderDraft): Promise<"done" | "back"> {
	try {
		const ids = await fetchOpenAIModelIds({ baseUrl: draft.config.baseUrl, apiKey: draft.config.apiKey });
		if (ids.length === 0) {
			ctx.ui.notify("/models returned no model ids", "warning");
			return "done";
		}

		let remaining = [...ids];
		while (remaining.length > 0) {
			const choice = await customSelect(ctx, "Add a model from /models", [...remaining, "Done"]);
			const value = selectValue(choice);
			if (value == null) return "back";
			if (value === "Done") return "done";
			if (await addEnrichedModel(ctx, draft, value)) {
				remaining = remaining.filter((id) => id !== value);
			} else {
				return "back";
			}
		}
		return "done";
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Could not import models: ${message}`, "warning");
		return "done";
	}
}

async function editModelJson(ctx: any, draft: ProviderDraft, index: number): Promise<void> {
	const current = modelList(draft.config)[index];
	if (!current) return;
	const next = await ctx.ui.editor(`Edit model ${current.id} JSON`, `${JSON.stringify(current, null, 2)}\n`);
	if (next == null) return;
	try {
		const parsed = JSON.parse(next);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { id?: unknown }).id !== "string") {
			throw new Error("expected an object with a string id");
		}
		draft.config.models = replaceModelAtIndex(modelList(draft.config), index, parsed as ProviderModelConfig);
		ctx.ui.notify(`Updated model ${(parsed as ProviderModelConfig).id}`, "info");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Invalid model JSON: ${message}`, "error");
	}
}

async function removeModel(ctx: any, draft: ProviderDraft, index: number): Promise<void> {
	const current = modelList(draft.config)[index];
	if (!current) return;
	const confirmed = await ctx.ui.confirm(`Remove ${current.id}?`, "This only affects the in-memory draft until you save.");
	if (!confirmed) return;
	draft.config.models = removeModelAtIndex(modelList(draft.config), index);
}

export async function manageModels(ctx: any, draft: ProviderDraft): Promise<void> {
	const MANAGE_ACTIONS = {
		add: "Add model",
		remove: "Remove model",
		replace: "Replace/edit model",
		preview: "Preview models",
		back: "Back",
	} as const;

	for (;;) {
		// First level: choose action
		const actionChoice = await customSelect(ctx, "Manage models", [
			MANAGE_ACTIONS.add,
			MANAGE_ACTIONS.remove,
			MANAGE_ACTIONS.replace,
			MANAGE_ACTIONS.preview,
			MANAGE_ACTIONS.back,
		]);
		const action = selectValue(actionChoice);
		if (action == null || action === MANAGE_ACTIONS.back) return;

		if (action === MANAGE_ACTIONS.add) {
			for (;;) {
				const addChoice = await customSelect(ctx, "Add model", [
					MODEL_MENU.addManual,
					MODEL_MENU.importModels,
					MODEL_MENU.back,
				]);
				const addValue = selectValue(addChoice);
				if (addValue == null || addValue === MODEL_MENU.back) break;
				const result = addValue === MODEL_MENU.addManual
					? await addManualModel(ctx, draft)
					: await importFromOpenAIModels(ctx, draft);
				if (result === "done") break;
			}
			continue;
		}

		const models = modelList(draft.config);
		if (models.length === 0) {
			ctx.ui.notify("No models to manage. Add a model first.", "info");
			continue;
		}

		if (action === MANAGE_ACTIONS.remove) {
			const labels = models.map((model, index) => modelLabel(index, model));
			const choice = await customSelect(ctx, "Remove model", [...labels, MODEL_MENU.back]);
			const value = selectValue(choice);
			if (value == null || value === MODEL_MENU.back) continue;
			const selectedIndex = labels.indexOf(value);
			if (selectedIndex >= 0) {
				await removeModel(ctx, draft, selectedIndex);
			}
			continue;
		}

		if (action === MANAGE_ACTIONS.replace) {
			const labels = models.map((model, index) => modelLabel(index, model));
			const choice = await customSelect(ctx, "Replace/edit model", [...labels, MODEL_MENU.back]);
			const value = selectValue(choice);
			if (value == null || value === MODEL_MENU.back) continue;
			const selectedIndex = labels.indexOf(value);
			if (selectedIndex >= 0) {
				await editModelJson(ctx, draft, selectedIndex);
			}
			continue;
		}

		if (action === MANAGE_ACTIONS.preview) {
			await previewModelsJson(ctx, models);
			continue;
		}
	}
}



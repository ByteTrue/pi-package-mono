import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createCustomInput, createCustomSelect } from "./custom-select.js";
import { enrichModelId } from "./enrich.js";
import { fuzzyFilter } from "./fuzzy.js";
import {
	createNewProviderDraft,
	createProviderDraft,
	getModelsJsonPath,
	readModelsJson,
	type ModelsJson,
	type ProviderConfig,
	type ProviderDraft,
	type ProviderModelConfig,
	upsertProvider,
	writeModelsJson,
} from "./models-json.js";
import { formatOfficialCandidate, groupOfficialModelsById, listAllOfficialModels, loadOfficialCatalog, stripOfficialRoutingFields } from "./official-catalog.js";
import { fetchOpenAIModelIds } from "./openai-models.js";

const COMMAND_NAME = "vendor";
const VENDOR_OVERLAY_OPTIONS = { anchor: "center", width: 92 } as const;

const PROVIDER_MENU = {
	editKey: "Edit provider key",
	editName: "Edit display name",
	editBaseUrl: "Edit base URL",
	editApiKey: "Edit API key / env reference",
	editApiFormat: "Edit API format",
	editAuthHeader: "Edit auth header flag",
	editCompat: "Edit compatibility JSON",
	manageModels: "Manage models",
	preview: "Preview provider JSON",
	save: "Save provider",
	cancel: "Cancel",
} as const;

const MODEL_MENU = {
	addManual: "Add manual model id",
	importModels: "Import from /models endpoint",
	remove: "Remove model",
	replace: "Replace/edit model JSON",
	preview: "Preview selected models",
	back: "Back to provider form",
} as const;

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function providerLabel(key: string, config: ProviderConfig): string {
	const name = config.name?.trim();
	const baseUrl = config.baseUrl?.trim();
	return [key, name ? `(${name})` : null, baseUrl ? `- ${baseUrl}` : null].filter(Boolean).join(" ");
}

function modelLabel(index: number, model: ProviderModelConfig): string {
	const name = model.name?.trim();
	return `${index + 1}. ${model.id}${name && name !== model.id ? ` - ${name}` : ""}`;
}

function modelList(config: ProviderConfig): ProviderModelConfig[] {
	return Array.isArray(config.models) ? config.models.map((model) => cloneJson(model)) : [];
}

function upsertModel(models: ProviderModelConfig[], model: ProviderModelConfig): ProviderModelConfig[] {
	const next = models.map((entry) => cloneJson(entry));
	const index = next.findIndex((entry) => entry.id === model.id);
	if (index >= 0) {
		next[index] = cloneJson(model);
		return next;
	}
	next.push(cloneJson(model));
	return next;
}

function removeModelAtIndex(models: ProviderModelConfig[], index: number): ProviderModelConfig[] {
	return models.filter((_, current) => current !== index).map((entry) => cloneJson(entry));
}

function replaceModelAtIndex(models: ProviderModelConfig[], index: number, model: ProviderModelConfig): ProviderModelConfig[] {
	const next = removeModelAtIndex(models, index);
	return upsertModel(next, model);
}

/**
 * Custom select with wrap-around navigation and pagination using ctx.ui.custom().
 * - Up/down arrows: navigate within current page (with wrap-around)
 * - Left/right arrows: change page
 * - Enter: select current item
 * - Escape: go back
 */
type SelectResult<T extends string> = { type: "select"; value: T } | null;

async function customSelect<T extends string>(ctx: any, title: string, items: string[], defaultValue?: string, escapeLabel?: string): Promise<SelectResult<T>> {
	if (items.length === 0) return null;
	return ctx.ui.custom(
		createCustomSelect<T>({ title, items, defaultValue, maxVisible: 10, escapeLabel }),
		{
			overlay: true,
			overlayOptions: VENDOR_OVERLAY_OPTIONS,
		},
	);
}

/** Helper to extract string value from customSelect result */
function selectValue(result: SelectResult<string>): string | null {
	if (result && result.type === "select") return result.value;
	return null;
}

/**
 * Custom input using ctx.ui.custom() with border.
 */
async function customInput(ctx: any, title: string, placeholder?: string, defaultValue?: string): Promise<string | null> {
	return ctx.ui.custom(
		createCustomInput({ title, placeholder, defaultValue }),
		{
			overlay: true,
			overlayOptions: VENDOR_OVERLAY_OPTIONS,
		},
	);
}

async function promptInput(ctx: any, title: string, current: string, hint: string): Promise<string | null> {
	const value = await customInput(ctx, title, hint ? `${hint}${current ? ` (current: ${current})` : ""}` : current, current);
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : current;
}

async function promptJsonObject<T extends object>(ctx: any, title: string, current: T): Promise<T | null | undefined> {
	const text = await ctx.ui.editor(title, `${JSON.stringify(current, null, 2)}\n`);
	if (text == null) return null;
	try {
		const parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("expected a JSON object");
		}
		return parsed as T;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Invalid JSON: ${message}`, "error");
		return undefined;
	}
}

async function previewProviderJson(ctx: any, draft: ProviderDraft): Promise<void> {
	await ctx.ui.editor("Preview provider JSON", `${JSON.stringify(draft.config, null, 2)}\n`);
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

async function manageModels(ctx: any, draft: ProviderDraft): Promise<void> {
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

async function editProviderKey(ctx: any, draft: ProviderDraft): Promise<void> {
	const next = await customInput(ctx, "Provider key", "", draft.key);
	if (next == null || !next.trim()) return;
	draft.key = next.trim();
}

async function editProviderDraft(ctx: any, draft: ProviderDraft): Promise<ProviderDraft | "back" | null> {
	for (;;) {
		const choice = await customSelect(ctx, `Vendor: ${draft.key}`, [
			PROVIDER_MENU.editKey,
			PROVIDER_MENU.editName,
			PROVIDER_MENU.editBaseUrl,
			PROVIDER_MENU.editApiKey,
			PROVIDER_MENU.editApiFormat,
			PROVIDER_MENU.editAuthHeader,
			PROVIDER_MENU.editCompat,
			PROVIDER_MENU.manageModels,
			PROVIDER_MENU.preview,
			PROVIDER_MENU.save,
			PROVIDER_MENU.cancel,
		], undefined, "goes back");
		const choiceValue = selectValue(choice);
		if (choiceValue == null) return "back";
		if (choiceValue === PROVIDER_MENU.cancel) return null;
		if (choiceValue === PROVIDER_MENU.editKey) {
			await editProviderKey(ctx, draft);
			continue;
		}
		if (choiceValue === PROVIDER_MENU.editName) {
			const next = await promptInput(ctx, "Display name", draft.config.name ?? "", "Enter a display name");
			if (next != null) draft.config.name = next;
			continue;
		}
		if (choiceValue === PROVIDER_MENU.editBaseUrl) {
			const next = await promptInput(ctx, "Base URL", draft.config.baseUrl ?? "", "Enter the provider base URL");
			if (next != null) draft.config.baseUrl = next;
			continue;
		}
		if (choiceValue === PROVIDER_MENU.editApiKey) {
			const next = await promptInput(ctx, "API key / env reference", draft.config.apiKey ?? "", "Use a literal key or an env ref like $OPENAI_API_KEY");
			if (next != null) draft.config.apiKey = next;
			continue;
		}
		if (choiceValue === PROVIDER_MENU.editApiFormat) {
			const choices = ["openai-completions", "openai-responses", "anthropic-messages", "custom value..."];
			const current = draft.config.api?.trim();
			const defaultChoice = current && choices.includes(current) ? current : current ? "custom value..." : "openai-completions";
			const apiChoice = await customSelect(ctx, "API format", choices, defaultChoice);
			const apiChoiceValue = selectValue(apiChoice);
			if (apiChoiceValue == null) continue;
			if (apiChoiceValue === "custom value...") {
				const next = await promptInput(ctx, "Custom API format", draft.config.api ?? "", "Enter the provider api value");
				if (next != null) draft.config.api = next;
				continue;
			}
			draft.config.api = apiChoiceValue;
			continue;
		}
		if (choiceValue === PROVIDER_MENU.editAuthHeader) {
			const current = draft.config.authHeader;
			const apiChoice = await customSelect(ctx, "authHeader", ["true", "false", "unset"], current === undefined ? "unset" : current ? "true" : "false");
			const apiChoiceValue = selectValue(apiChoice);
			if (apiChoiceValue == null) continue;
			if (apiChoiceValue === "unset") {
				delete draft.config.authHeader;
			} else {
				draft.config.authHeader = apiChoiceValue === "true";
			}
			continue;
		}
		if (choiceValue === PROVIDER_MENU.editCompat) {
			const next = await promptJsonObject<Record<string, unknown>>(ctx, "Compatibility JSON", draft.config.compat ?? {});
			if (next != null && next !== undefined) draft.config.compat = next;
			continue;
		}
		if (choiceValue === PROVIDER_MENU.manageModels) {
			await manageModels(ctx, draft);
			continue;
		}
		if (choiceValue === PROVIDER_MENU.preview) {
			await previewProviderJson(ctx, draft);
			continue;
		}
		if (choiceValue === PROVIDER_MENU.save) {
			return draft;
		}
	}
}

function pickProvider(modelsJson: ModelsJson): Array<{ key: string; label: string }> {
	const providers = modelsJson.providers ?? {};
	return Object.entries(providers)
		.map(([key, config]) => ({ key, label: providerLabel(key, config) }))
		.sort((left, right) => left.label.localeCompare(right.label));
}

async function chooseProviderDraft(ctx: any, modelsJson: ModelsJson): Promise<ProviderDraft | null> {
	const providers = pickProvider(modelsJson);
	for (;;) {
		const choice = await customSelect(ctx, "Custom providers", [...providers.map((provider) => provider.label), "Add provider..."], undefined, "exits");
		const choiceValue = selectValue(choice);
		if (choiceValue == null) return null;
		if (choiceValue === "Add provider...") {
			const key = await customInput(ctx, "Provider key", "Enter a unique provider key");
			if (key == null || !key.trim()) continue;
			const trimmed = key.trim();
			const existing = modelsJson.providers?.[trimmed];
			return existing ? createProviderDraft(trimmed, existing) : createNewProviderDraft(trimmed);
		}

		const picked = providers.find((provider) => provider.label === choiceValue);
		if (!picked) continue;
		const existing = modelsJson.providers?.[picked.key];
		return existing ? createProviderDraft(picked.key, existing) : createNewProviderDraft(picked.key);
	}
}

export function registerVendorCommand(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Manage custom providers in ~/.pi/agent/models.json",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(`/vendor needs interactive mode. Edit ${getModelsJsonPath()} directly if you want to work non-interactively.`, "error");
				return;
			}

			let modelsJson: ModelsJson;
			try {
				modelsJson = readModelsJson();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, "error");
				return;
			}

			for (;;) {
				const draft = await chooseProviderDraft(ctx, modelsJson);
				if (!draft) {
					ctx.ui.notify("Vendor config unchanged", "info");
					return;
				}

				const edited = await editProviderDraft(ctx, draft);
				if (edited === "back") continue;
				if (!edited) {
					ctx.ui.notify("Vendor config unchanged", "info");
					return;
				}

				let currentModels: ModelsJson;
				try {
					currentModels = readModelsJson();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Could not re-read models.json: ${message}`, "error");
					return;
				}

				if (draft.originalKey !== edited.key) {
					const confirmed = await ctx.ui.confirm(
						`Rename provider ${draft.originalKey} -> ${edited.key}?`,
						`The old provider entry will be removed from ${getModelsJsonPath()} when you save.`,
					);
					if (!confirmed) {
						ctx.ui.notify("Vendor config unchanged", "info");
						return;
					}
				}
				if (edited.key !== draft.originalKey && currentModels.providers?.[edited.key]) {
					const confirmed = await ctx.ui.confirm(
						`Overwrite existing provider ${edited.key}?`,
						`This will replace the current entry in ${getModelsJsonPath()} when you save.`,
					);
					if (!confirmed) {
						ctx.ui.notify("Vendor config unchanged", "info");
						return;
					}
				}

				try {
					const next = upsertProvider(currentModels, edited, { previousKey: draft.originalKey });
					writeModelsJson(next);
					ctx.ui.notify("Saved provider. Open /model to refresh model selection.", "info");
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Failed to save models.json: ${message}`, "error");
				}
				return;
			}
		},
	});
}

export default async function registerVendor(pi: ExtensionAPI): Promise<void> {
	registerVendorCommand(pi);
}

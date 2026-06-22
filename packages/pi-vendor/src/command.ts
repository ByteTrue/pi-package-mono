import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { enrichModelId } from "./enrich.js";
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
import { formatOfficialCandidate, stripOfficialRoutingFields } from "./official-catalog.js";
import { fetchOpenAIModelIds } from "./openai-models.js";
import { listModelTemplates, templateLabel } from "./templates.js";

const COMMAND_NAME = "vendor";

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
	addTemplate: "Add from local model/template library",
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

async function promptInput(ctx: any, title: string, current: string, hint: string): Promise<string | null> {
	const value = await ctx.ui.input(title, hint ? `${hint}${current ? ` (current: ${current})` : ""}` : current);
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
	const choice = await ctx.ui.select(`Choose an official config for ${candidates[0]?.model.id ?? "model"}`, labels, {});
	if (choice == null) return null;
	return labels.indexOf(choice);
}

async function addEnrichedModel(ctx: any, draft: ProviderDraft, modelId: string): Promise<void> {
	const outcome = await enrichModelId(modelId);
	if (outcome.kind === "official-ambiguous") {
		const choice = await selectOfficialCandidate(ctx, outcome.candidates);
		if (choice == null) return;
		const chosen = outcome.candidates[choice];
		if (!chosen) return;
		draft.config.models = upsertModel(modelList(draft.config), stripOfficialRoutingFields(chosen.model));
		ctx.ui.notify(`Added ${chosen.model.id} from ${chosen.provider}`, "info");
		return;
	}

	let model = outcome.model;
	if (outcome.source === "default") {
		const edited = await ctx.ui.editor(`Review model ${modelId}`, `${JSON.stringify(model, null, 2)}\n`);
		if (edited == null) return;
		try {
			const parsed = JSON.parse(edited);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { id?: unknown }).id !== "string") {
				throw new Error("expected an object with a string id");
			}
			model = parsed as ProviderModelConfig;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Invalid model JSON: ${message}`, "error");
			return;
		}
	}

	draft.config.models = upsertModel(modelList(draft.config), model);
	ctx.ui.notify(`Added ${model.id} from ${outcome.source}`, "info");
}

async function addManualModel(ctx: any, draft: ProviderDraft): Promise<void> {
	const input = await ctx.ui.input("Model id", "Enter a model id, e.g. gpt-4o");
	if (input == null || !input.trim()) return;
	await addEnrichedModel(ctx, draft, input.trim());
}

async function addFromTemplateLibrary(ctx: any, draft: ProviderDraft): Promise<void> {
	const templates = listModelTemplates();
	const labels = templates.map((template) => templateLabel(template));
	const choice = await ctx.ui.select("Pick a local template", labels, {});
	if (choice == null) return;
	const template = templates[labels.indexOf(choice)];
	if (!template) return;

	if (template.id) {
		await addEnrichedModel(ctx, draft, template.id);
		return;
	}

	const prefix = template.prefix ?? "model";
	const modelId = await ctx.ui.input(`Model id for ${prefix}*`, prefix);
	if (modelId == null || !modelId.trim()) return;
	await addEnrichedModel(ctx, draft, modelId.trim());
}

async function importFromOpenAIModels(ctx: any, draft: ProviderDraft): Promise<void> {
	try {
		const ids = await fetchOpenAIModelIds({ baseUrl: draft.config.baseUrl, apiKey: draft.config.apiKey });
		if (ids.length === 0) {
			ctx.ui.notify("/models returned no model ids", "warning");
			return;
		}

		let remaining = [...ids];
		while (remaining.length > 0) {
			const choice = await ctx.ui.select("Add a model from /models", [...remaining, "Done"], {});
			if (choice == null || choice === "Done") return;
			remaining = remaining.filter((id) => id !== choice);
			await addEnrichedModel(ctx, draft, choice);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Could not import models: ${message}`, "warning");
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
	for (;;) {
		const models = modelList(draft.config);
		const labels = models.map((model, index) => modelLabel(index, model));
		const choice = await ctx.ui.select("Manage draft models", [...labels, MODEL_MENU.addManual, MODEL_MENU.addTemplate, MODEL_MENU.importModels, MODEL_MENU.preview, MODEL_MENU.back], {});
		if (choice == null || choice === MODEL_MENU.back) return;

		const selectedIndex = labels.indexOf(choice);
		if (selectedIndex >= 0) {
			const modelChoice = await ctx.ui.select(`Model ${models[selectedIndex]?.id ?? ""}`, [MODEL_MENU.replace, MODEL_MENU.remove, MODEL_MENU.back], {});
			if (modelChoice === MODEL_MENU.replace) {
				await editModelJson(ctx, draft, selectedIndex);
			}
			if (modelChoice === MODEL_MENU.remove) {
				await removeModel(ctx, draft, selectedIndex);
			}
			continue;
		}

		if (choice === MODEL_MENU.addManual) {
			await addManualModel(ctx, draft);
			continue;
		}
		if (choice === MODEL_MENU.addTemplate) {
			await addFromTemplateLibrary(ctx, draft);
			continue;
		}
		if (choice === MODEL_MENU.importModels) {
			await importFromOpenAIModels(ctx, draft);
			continue;
		}
		if (choice === MODEL_MENU.preview) {
			await previewModelsJson(ctx, models);
		}
	}
}

async function editProviderKey(ctx: any, draft: ProviderDraft): Promise<void> {
	const next = await ctx.ui.input("Provider key", draft.key);
	if (next == null || !next.trim()) return;
	draft.key = next.trim();
}

async function editProviderDraft(ctx: any, draft: ProviderDraft): Promise<ProviderDraft | null> {
	for (;;) {
		const choice = await ctx.ui.select(`Vendor: ${draft.key}`, [
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
		], {});
		if (choice == null || choice === PROVIDER_MENU.cancel) return null;
		if (choice === PROVIDER_MENU.editKey) {
			await editProviderKey(ctx, draft);
			continue;
		}
		if (choice === PROVIDER_MENU.editName) {
			const next = await promptInput(ctx, "Display name", draft.config.name ?? "", "Enter a display name");
			if (next != null) draft.config.name = next;
			continue;
		}
		if (choice === PROVIDER_MENU.editBaseUrl) {
			const next = await promptInput(ctx, "Base URL", draft.config.baseUrl ?? "", "Enter the provider base URL");
			if (next != null) draft.config.baseUrl = next;
			continue;
		}
		if (choice === PROVIDER_MENU.editApiKey) {
			const next = await promptInput(ctx, "API key / env reference", draft.config.apiKey ?? "", "Use a literal key or an env ref like $OPENAI_API_KEY");
			if (next != null) draft.config.apiKey = next;
			continue;
		}
		if (choice === PROVIDER_MENU.editApiFormat) {
			const choices = ["openai-completions", "openai-responses", "anthropic-messages", "custom value..."];
			const current = draft.config.api?.trim();
			const defaultChoice = current && choices.includes(current) ? current : current ? "custom value..." : "openai-completions";
			const apiChoice = await ctx.ui.select("API format", choices, { default: defaultChoice });
			if (apiChoice == null) continue;
			if (apiChoice === "custom value...") {
				const next = await promptInput(ctx, "Custom API format", draft.config.api ?? "", "Enter the provider api value");
				if (next != null) draft.config.api = next;
				continue;
			}
			draft.config.api = apiChoice;
			continue;
		}
		if (choice === PROVIDER_MENU.editAuthHeader) {
			const current = draft.config.authHeader;
			const apiChoice = await ctx.ui.select("authHeader", ["true", "false", "unset"], {
				default: current === undefined ? "unset" : current ? "true" : "false",
			});
			if (apiChoice == null) continue;
			if (apiChoice === "unset") {
				delete draft.config.authHeader;
			} else {
				draft.config.authHeader = apiChoice === "true";
			}
			continue;
		}
		if (choice === PROVIDER_MENU.editCompat) {
			const next = await promptJsonObject<Record<string, unknown>>(ctx, "Compatibility JSON", draft.config.compat ?? {});
			if (next != null && next !== undefined) draft.config.compat = next;
			continue;
		}
		if (choice === PROVIDER_MENU.manageModels) {
			await manageModels(ctx, draft);
			continue;
		}
		if (choice === PROVIDER_MENU.preview) {
			await previewProviderJson(ctx, draft);
			continue;
		}
		if (choice === PROVIDER_MENU.save) {
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
	const choice = await ctx.ui.select("Custom providers", [...providers.map((provider) => provider.label), "Add provider..."], {});
	if (choice == null) return null;
	if (choice === "Add provider...") {
		const key = await ctx.ui.input("Provider key", "Enter a unique provider key");
		if (key == null || !key.trim()) return null;
		const trimmed = key.trim();
		const existing = modelsJson.providers?.[trimmed];
		return existing ? createProviderDraft(trimmed, existing) : createNewProviderDraft(trimmed);
	}

	const picked = providers.find((provider) => provider.label === choice);
	if (!picked) return null;
	const existing = modelsJson.providers?.[picked.key];
	return existing ? createProviderDraft(picked.key, existing) : createNewProviderDraft(picked.key);
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

			const draft = await chooseProviderDraft(ctx, modelsJson);
			if (!draft) {
				ctx.ui.notify("Vendor config unchanged", "info");
				return;
			}

			const edited = await editProviderDraft(ctx, draft);
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
		},
	});
}

export default async function registerVendor(pi: ExtensionAPI): Promise<void> {
	registerVendorCommand(pi);
}

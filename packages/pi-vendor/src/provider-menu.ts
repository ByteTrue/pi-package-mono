import type { ModelsJson, ProviderConfig, ProviderDraft } from "./models-json.js";
import { createNewProviderDraft, createProviderDraft } from "./models-json.js";
import { manageModels } from "./models-menu.js";
import { customInput, customSelect, promptInput, promptJsonObject, selectValue } from "./vendor-ui.js";

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

function providerLabel(key: string, config: ProviderConfig): string {
	const name = config.name?.trim();
	const baseUrl = config.baseUrl?.trim();
	return [key, name ? `(${name})` : null, baseUrl ? `- ${baseUrl}` : null].filter(Boolean).join(" ");
}

async function previewProviderJson(ctx: any, draft: ProviderDraft): Promise<void> {
	await ctx.ui.editor("Preview provider JSON", `${JSON.stringify(draft.config, null, 2)}\n`);
}

async function editProviderKey(ctx: any, draft: ProviderDraft): Promise<void> {
	const next = await customInput(ctx, "Provider key", "", draft.key);
	if (next == null || !next.trim()) return;
	draft.key = next.trim();
}

export async function editProviderDraft(ctx: any, draft: ProviderDraft): Promise<ProviderDraft | "back" | null> {
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

export async function chooseProviderDraft(ctx: any, modelsJson: ModelsJson): Promise<ProviderDraft | null> {
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


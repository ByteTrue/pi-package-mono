// Quick add-provider flow for /vendor TUI.
// One straight line: key → baseUrl → api → apiKey → one model → save.
// The api key is collected before the model step because listing upstream
// models needs it.

import { createProvider } from "../config-document.js";
import type { ModelsJson, ProviderConfig } from "../models-json.js";
import { acquireOneModel, type AcquireOptions } from "./model-pick.js";
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

/**
 * Create one provider with exactly one model. Esc at any step cancels with
 * zero writes; to add more models, run the flow again or ask the agent.
 */
export async function runAddProviderFlow(
	ui: QuickUI,
	models: ModelsJson,
	options?: AcquireOptions,
): Promise<AddProviderResult> {
	const key = await acquireProviderKey(ui, models);
	if (key === null) return { kind: "cancelled" };

	const baseUrl = await acquireBaseUrl(ui);
	if (baseUrl === null) return { kind: "cancelled" };

	const api = await acquireApiFormat(ui);
	if (api === null) return { kind: "cancelled" };

	const apiKey = await acquireApiKey(ui);
	if (apiKey === null) return { kind: "cancelled" };

	// No initialProvider: this provider is not on disk, so a `!command` key is
	// not yet trusted and discovery is skipped for it.
	const model = await acquireOneModel(ui, { baseUrl, api, apiKey }, options);
	if (model === null) return { kind: "cancelled" };

	const providerConfig: ProviderConfig = { baseUrl, api, apiKey, models: [model] };
	const draft = { ...models, providers: { ...(models.providers ?? {}) } };
	const created = createProvider(draft, key, providerConfig);
	if (!created.ok) {
		ui.notify(`Cannot create provider: ${created.error.message}`, "error");
		return { kind: "cancelled" };
	}

	return { kind: "saved", models: created.value };
}

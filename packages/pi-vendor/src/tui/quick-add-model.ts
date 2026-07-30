// Quick add-model flow for /vendor TUI.
// One straight line: one model for an existing provider, then save.

import { addModel, replaceModel } from "../config-document.js";
import type { ModelsJson } from "../models-json.js";
import { acquireOneModel, type AcquireOptions } from "./model-pick.js";
import type { QuickUI } from "./quick-adapter.js";

export type AddModelResult =
	| { kind: "saved"; models: ModelsJson }
	| { kind: "cancelled" };

/**
 * Add exactly one model to an existing provider. Esc at any step cancels with
 * zero writes; to add more models, run the flow again or ask the agent.
 *
 * `initialProvider` is the on-disk credential snapshot, required before any
 * `!command` credential of this provider may be executed for discovery.
 */
export async function runAddModelFlow(
	ui: QuickUI,
	providerKey: string,
	models: ModelsJson,
	initialProvider?: { apiKey?: string; headers?: Record<string, string> },
	options?: AcquireOptions,
): Promise<AddModelResult> {
	const provider = models.providers?.[providerKey];
	if (!provider?.baseUrl) {
		ui.notify(`Provider "${providerKey}" has no base URL.`, "error");
		return { kind: "cancelled" };
	}

	const model = await acquireOneModel(ui, {
		baseUrl: provider.baseUrl,
		api: typeof provider.api === "string" ? provider.api : undefined,
		apiKey: typeof provider.apiKey === "string" ? provider.apiKey : undefined,
		headers: provider.headers,
		initialProvider,
	}, options);
	if (model === null) return { kind: "cancelled" };

	const exists = (provider.models ?? []).some((entry) => entry.id === model.id);
	if (exists) {
		const confirmed = await ui.confirm(
			`Model "${model.id}" already exists in ${providerKey}. Replace it?`,
			"The existing model configuration will be overwritten.",
		);
		if (!confirmed) return { kind: "cancelled" };

		const replaced = replaceModel(models, providerKey, model.id, model, { conflict: "overwrite-confirmed" });
		if (!replaced.ok) {
			ui.notify(`Failed to replace model: ${replaced.error.message}`, "error");
			return { kind: "cancelled" };
		}
		return { kind: "saved", models: replaced.value };
	}

	const added = addModel(models, providerKey, model);
	if (!added.ok) {
		ui.notify(`Failed to add model: ${added.error.message}`, "error");
		return { kind: "cancelled" };
	}
	return { kind: "saved", models: added.value };
}

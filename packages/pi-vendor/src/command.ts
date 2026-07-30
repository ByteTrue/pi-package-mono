import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { commitModelsSnapshot, ConfigCoreError, readModelsSnapshot, type ConfigRevision } from "./config-core.js";
import { getModelsJsonPath, type ModelsJson } from "./models-json.js";
import { createProductionQuickUI } from "./tui/quick-adapter.js";
import type { QuickUI } from "./tui/quick-adapter.js";
import { runAddModelFlow, type AddModelResult } from "./tui/quick-add-model.js";
import { runAddProviderFlow } from "./tui/quick-add-provider.js";
import { showRootMenu, supportsInteractiveUI } from "./tui/quick-root.js";

const COMMAND_NAME = "vendor";

type SaveContext = {
	ui: { notify: (message: string, type?: "info" | "warning" | "error") => void };
	// Pi 0.82 made refresh() async; getError() only reflects the new config after it settles.
	modelRegistry: { refresh(): void | Promise<void>; getError(): string | undefined };
};

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Commit exactly once, then refresh the model registry exactly once.
 *
 * The refreshed registry is the authoritative compatibility oracle: it is the
 * running Pi, so it needs no version detection and no temp file.
 */
async function saveAndRefresh(ctx: SaveContext, models: ModelsJson, expectedRevision: ConfigRevision): Promise<void> {
	try {
		commitModelsSnapshot({ models, expectedRevision });
	} catch (error) {
		if (error instanceof ConfigCoreError && error.code === "config_changed") {
			ctx.ui.notify("Configuration changed by another process. Please re-open /vendor.", "error");
		} else {
			ctx.ui.notify(`Failed to save: ${describe(error)}`, "error");
		}
		return;
	}

	try {
		await ctx.modelRegistry.refresh();
		const registryError = ctx.modelRegistry.getError();
		if (registryError) {
			ctx.ui.notify(`Configuration saved but Pi rejected it: ${registryError}`, "warning");
		} else {
			ctx.ui.notify("Configuration saved and models refreshed.", "info");
		}
	} catch (error) {
		ctx.ui.notify(`Configuration saved but model reload failed: ${describe(error)}`, "warning");
	}
}

/** Select the target provider, then add one model to it. */
export async function selectProviderAndAddModel(ui: QuickUI, models: ModelsJson): Promise<AddModelResult> {
	const providerKeys = Object.keys(models.providers ?? {});
	if (providerKeys.length === 0) {
		ui.notify('No providers configured. Choose "Add provider" first.', "warning");
		return { kind: "cancelled" };
	}

	const providerKey = await ui.select({
		message: "Select provider:",
		choices: providerKeys.map((key) => ({ value: key, label: key })),
	});
	if (!providerKey) return { kind: "cancelled" };

	const provider = models.providers?.[providerKey];
	const initialProvider = provider
		? {
			apiKey: typeof provider.apiKey === "string" ? provider.apiKey : undefined,
			headers: provider.headers,
		}
		: undefined;

	return runAddModelFlow(ui, providerKey, models, initialProvider);
}

export function registerVendorCommand(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Add a custom provider or model in ~/.pi/agent/models.json",
		handler: async (args, ctx) => {
			if (String(args ?? "").trim() !== "") {
				ctx.ui.notify("Usage: /vendor", "error");
				return;
			}

			if (!supportsInteractiveUI(ctx.mode, ctx.hasUI)) {
				ctx.ui.notify(
					`/vendor needs interactive TUI mode. Edit ${getModelsJsonPath()} directly if you want to work non-interactively.`,
					"error",
				);
				return;
			}

			let snapshot;
			try {
				snapshot = readModelsSnapshot();
			} catch (error) {
				ctx.ui.notify(describe(error), "error");
				return;
			}

			const ui = createProductionQuickUI(ctx.ui as never);
			const action = await showRootMenu(ui);
			if (!action) {
				ctx.ui.notify("Vendor config unchanged.", "info");
				return;
			}

			const result = action === "add-provider"
				? await runAddProviderFlow(ui, snapshot.models)
				: await selectProviderAndAddModel(ui, snapshot.models);

			if (result.kind === "cancelled") {
				ctx.ui.notify("Vendor config unchanged.", "info");
				return;
			}

			await saveAndRefresh(ctx, result.models, snapshot.revision);
		},
	});
}

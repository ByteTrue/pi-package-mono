import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	getModelsJsonPath,
} from "./models-json.js";
import { readModelsSnapshot, commitModelsSnapshot, ConfigCoreError } from "./config-core.js";
import { showRootMenu, supportsInteractiveUI } from "./tui/quick-root.js";
import { createProductionQuickUI } from "./tui/quick-adapter.js";
import { runAddModelFlow } from "./tui/quick-add-model.js";
import { runAddProviderFlow } from "./tui/quick-add-provider.js";

const COMMAND_NAME = "vendor";

export function registerVendorCommand(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Manage custom providers in ~/.pi/agent/models.json",
		handler: async (args, ctx) => {
			const arg = String(args ?? "").trim();

			// /vendor (no args) — quick-flow TUI
			if (arg !== "") {
				ctx.ui.notify("Usage: /vendor", "error");
				return;
			}

			if (!supportsInteractiveUI(ctx.mode, ctx.hasUI)) {
				ctx.ui.notify(`/vendor needs interactive TUI mode. Edit ${getModelsJsonPath()} directly if you want to work non-interactively.`, "error");
				return;
			}

			// Read current snapshot once
			let snapshot;
			try {
				snapshot = readModelsSnapshot();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, "error");
				return;
			}

			const ui = createProductionQuickUI(ctx.ui as any);

			for (;;) {
				const action = await showRootMenu(ui);
				if (!action || action === "cancel") {
					ctx.ui.notify("Vendor config unchanged.", "info");
					return;
				}

				if (action === "add-model") {
					const providerKeys = Object.keys(snapshot.models.providers ?? {});
					if (providerKeys.length === 0) {
						ui.notify("No providers configured. Add a provider first.", "warning");
						continue;
					}

					const providerKey = await ui.select({
						message: "Select provider:",
						choices: providerKeys.map((k) => ({ value: k, label: k })),
					});
					if (!providerKey) continue;

					const provider = snapshot.models.providers?.[providerKey];
					const initialProvider = provider ? {
						apiKey: typeof provider.apiKey === "string" ? provider.apiKey : undefined,
						headers: provider.headers,
					} : undefined;

					const result = await runAddModelFlow(ui, providerKey, snapshot.models, initialProvider);
					if (result.kind === "cancelled") {
						ctx.ui.notify("Vendor config unchanged.", "info");
						return;
					}

					try {
						commitModelsSnapshot({ models: result.models, expectedRevision: snapshot.revision });
						try {
							ctx.modelRegistry.refresh();
							const error = ctx.modelRegistry.getError();
							if (error) {
								ctx.ui.notify(`Configuration saved but model reload failed: ${error}`, "warning");
							} else {
								ctx.ui.notify("Configuration saved and models refreshed.", "info");
							}
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							ctx.ui.notify(`Configuration saved but model reload failed: ${message}`, "warning");
						}
					} catch (err) {
						if (err instanceof ConfigCoreError && err.code === "config_changed") {
							ctx.ui.notify("Configuration changed by another process. Please re-open /vendor.", "error");
						} else {
							const message = err instanceof Error ? err.message : String(err);
							ctx.ui.notify(`Failed to save: ${message}`, "error");
						}
					}
					return;
				}

				if (action === "add-provider") {
					const result = await runAddProviderFlow(ui, snapshot.models);
					if (result.kind === "cancelled") {
						ctx.ui.notify("Vendor config unchanged.", "info");
						return;
					}

					try {
						commitModelsSnapshot({ models: result.models, expectedRevision: snapshot.revision });
						try {
							ctx.modelRegistry.refresh();
							const error = ctx.modelRegistry.getError();
							if (error) {
								ctx.ui.notify(`Configuration saved but model reload failed: ${error}`, "warning");
							} else {
								ctx.ui.notify("Configuration saved and models refreshed.", "info");
							}
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							ctx.ui.notify(`Configuration saved but model reload failed: ${message}`, "warning");
						}
					} catch (err) {
						if (err instanceof ConfigCoreError && err.code === "config_changed") {
							ctx.ui.notify("Configuration changed by another process. Please re-open /vendor.", "error");
						} else {
							const message = err instanceof Error ? err.message : String(err);
							ctx.ui.notify(`Failed to save: ${message}`, "error");
						}
					}
					return;
				}
			}
		},
	});
}

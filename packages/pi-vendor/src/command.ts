import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	getModelsJsonPath,
} from "./models-json.js";
import { readModelsSnapshot, commitModelsSnapshot, ConfigCoreError } from "./config-core.js";
import { showRootMenu, supportsInteractiveUI } from "./tui/quick-root.js";
import { createProductionQuickUI } from "./tui/quick-adapter.js";
import { runAddModelFlow } from "./tui/quick-add-model.js";
import { runAddProviderFlow } from "./tui/quick-add-provider.js";
import { startVendorWebSession } from "./web/server/session.js";
import type { VendorWebSession, VendorWebResult } from "./web/server/server.js";

const COMMAND_NAME = "vendor";

export async function runWebSession(
	ctx: { ui: { notify: (msg: string, level: string) => void; custom: (...args: any[]) => any }; modelRegistry: { refresh(): void; getError(): string | undefined } },
	options?: Parameters<typeof startVendorWebSession>[0],
): Promise<void> {
	let session: VendorWebSession | undefined;
	try {
		session = await startVendorWebSession(options);

		if (!session.browserOpened) {
			ctx.ui.notify(`Open this URL in your browser: ${session.url}`, "info");
		}

		// Esc-cancellable waiting UI via ctx.ui.custom
		const result = await new Promise<VendorWebResult>((resolve) => {
			const done = ctx.ui.custom(
				(_tui: unknown, _theme: unknown, keybindings: { matches: (key: string, binding: string) => boolean }, doneFn: (val: unknown) => void) => {
					// Start waiting in background
					session!.waitForResult().then((r) => {
						doneFn(r);
					});

					return {
						render(width: number): string[] {
							const msg = "Waiting for browser session… Press Esc to cancel.";
							return [
								`┌${"─".repeat(Math.min(width - 2, 60))}┐`,
								`│ ${msg}${" ".repeat(Math.max(0, Math.min(width - 2, 60) - msg.length - 1))}│`,
								`└${"─".repeat(Math.min(width - 2, 60))}┘`,
							];
						},
						handleInput(keyData: string): void {
							if (keybindings.matches(keyData, "tui.select.cancel")) {
								session!.stop();
								doneFn(null);
							}
						},
					};
				},
				{ overlay: true, overlayOptions: { anchor: "center", width: 62 } },
			);

			done.then((val: unknown) => {
				if (val === null) {
					resolve({ kind: "cancelled" as const });
				} else {
					resolve(val as VendorWebResult);
				}
			});
		});

		if (result.kind === "saved") {
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
		} else {
			ctx.ui.notify("Session cancelled. Configuration unchanged.", "info");
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.ui.notify(`Web session failed: ${message}`, "error");
	} finally {
		session?.stop();
	}
}

export function registerVendorCommand(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Manage custom providers in ~/.pi/agent/models.json",
		handler: async (args, ctx) => {
			const arg = String(args ?? "").trim();

			// /vendor web — launch web modal
			if (arg === "web") {
				if (!supportsInteractiveUI(ctx.mode, ctx.hasUI)) {
					ctx.ui.notify("/vendor web requires interactive TUI mode.", "error");
					return;
				}
				await runWebSession(ctx as any);
				return;
			}

			// /vendor (no args) — quick-flow TUI
			if (arg !== "") {
				ctx.ui.notify('Usage: /vendor or /vendor web. Use "web" to open the browser manager.', "error");
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

				if (action === "open-web") {
					await runWebSession(ctx as any);
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

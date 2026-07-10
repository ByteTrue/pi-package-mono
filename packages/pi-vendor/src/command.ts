import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	getModelsJsonPath,
	readModelsJson,
	type ModelsJson,
	upsertProvider,
	writeModelsJson,
} from "./models-json.js";
import { chooseProviderDraft, editProviderDraft } from "./provider-menu.js";

const COMMAND_NAME = "vendor";

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

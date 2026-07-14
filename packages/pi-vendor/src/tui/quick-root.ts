// Root menu for /vendor quick workflows.
// Implements the task-oriented entry point per roadmap §4.7.

import type { QuickUI } from "./quick-adapter.js";

export type RootAction =
	| "add-model"
	| "add-provider"
	| "open-web"
	| "cancel";

const ROOT_CHOICES: readonly { value: RootAction; label: string }[] = [
	{ value: "add-model", label: "Add model" },
	{ value: "add-provider", label: "Add provider" },
	{ value: "open-web", label: "Open full manager in browser" },
	{ value: "cancel", label: "Cancel" },
];

/**
 * Show the root /vendor menu.
 * - Default selection is "add-model"
 * - Esc/Cancel returns null (no write)
 * - Returns the selected action for dispatch
 */
export async function showRootMenu(ui: QuickUI): Promise<RootAction | null> {
	return ui.select<RootAction>({
		message: "Manage providers and models",
		choices: ROOT_CHOICES,
		default: "add-model",
	});
}

/**
 * Validate that a UI mode supports interactive TUI workflows.
 * Returns true if the mode allows UI interaction.
 */
export function supportsInteractiveUI(mode: string | undefined, hasUI: boolean | undefined): boolean {
	return hasUI === true && mode === "tui";
}

// Root menu for /vendor quick workflows.
// Implements the task-oriented entry point per roadmap §4.7.

import type { QuickUI } from "./quick-adapter.js";

export type RootAction =
	| "add-provider"
	| "add-model";

// Add provider first: cold start is the only path that must work without the agent.
const ROOT_CHOICES: readonly { value: RootAction; label: string }[] = [
	{ value: "add-provider", label: "Add provider" },
	{ value: "add-model", label: "Add model" },
];

/**
 * Show the root /vendor menu.
 * - Default selection is "add-provider"
 * - Esc returns null (no write)
 * - Returns the selected action for dispatch
 */
export async function showRootMenu(ui: QuickUI): Promise<RootAction | null> {
	return ui.select<RootAction>({
		message: "Manage providers and models",
		choices: ROOT_CHOICES,
		default: "add-provider",
	});
}

/**
 * Validate that a UI mode supports interactive TUI workflows.
 * Returns true if the mode allows UI interaction.
 */
export function supportsInteractiveUI(mode: string | undefined, hasUI: boolean | undefined): boolean {
	return hasUI === true && mode === "tui";
}

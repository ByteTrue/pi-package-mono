import type { QuickUI } from "./quick-adapter.js";
export type RootAction = "add-provider" | "add-model";
/**
 * Show the root /vendor menu.
 * - Default selection is "add-provider"
 * - Esc returns null (no write)
 * - Returns the selected action for dispatch
 */
export declare function showRootMenu(ui: QuickUI): Promise<RootAction | null>;
/**
 * Validate that a UI mode supports interactive TUI workflows.
 * Returns true if the mode allows UI interaction.
 */
export declare function supportsInteractiveUI(mode: string | undefined, hasUI: boolean | undefined): boolean;

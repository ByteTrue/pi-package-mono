/**
 * Raw JSON view — whole-document editor with Apply / Discard / Stay gate.
 */

import type { ProviderManagerState } from "./state.js";
import { esc } from "./provider-view.js";

export function renderRawView(state: ProviderManagerState): string {
	const rawText = state.rawText ?? JSON.stringify(state.draft, null, 2);
	const secretCount = state.secretSlots.length;
	const rawError = state.errors.find((e) => e.field === "raw")?.message;

	let html = '<main class="standalone-view raw-editor" id="main-content">';
	html += '<div class="standalone-header raw-header"><div>';
	html += '<p class="workspace-kicker">Advanced</p><h1>Raw JSON</h1>';
	html += '<p>Edit the complete configuration. Apply validates the draft before returning to the workspace.</p></div>';
	html += '<div class="raw-actions">';
	html += '<button class="btn-quiet" id="btn-discard-raw" type="button">Back to configuration</button>';
	html += '<button class="btn-save" id="btn-apply-raw" type="button">Apply JSON</button>';
	html += '</div></div>';
	if (secretCount > 0) {
		html += `<div class="raw-secret-hint"><strong>${secretCount} configured secret${secretCount === 1 ? "" : "s"}</strong><span>Keep their references in the same place. Moving or copying one cannot be saved.</span></div>`;
	}
	html += `<textarea id="raw-textarea" rows="20" autocomplete="off" spellcheck="false" aria-label="Raw configuration JSON">${esc(rawText)}</textarea>`;
	html += `<div id="raw-error" class="field-error" role="alert">${rawError ? esc(rawError) : ""}</div>`;
	html += '</main>';
	return html;
}

export function bindRawView(handlers: {
	onSetText(text: string): void;
	onApply(text: string): void;
	onDiscard(): void;
	onStay(): void;
}): void {
	const textarea = document.getElementById("raw-textarea") as HTMLTextAreaElement | null;
	textarea?.addEventListener("input", () => {
		if (textarea) handlers.onSetText(textarea.value);
	});
	document.getElementById("btn-apply-raw")?.addEventListener("click", () => {
		if (textarea) handlers.onApply(textarea.value);
	});
	document.getElementById("btn-discard-raw")?.addEventListener("click", () => handlers.onDiscard());
}

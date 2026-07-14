/**
 * Raw JSON view — whole-document editor with Apply / Discard / Stay gate.
 */

import type { ProviderManagerState } from "./state.js";
import { esc } from "./provider-view.js";

export function renderRawView(state: ProviderManagerState): string {
	const rawText = state.rawText ?? JSON.stringify(state.draft, null, 2);
	const secretCount = state.secretSlots.length;
	const rawError = state.errors.find((e) => e.field === "raw")?.message;

	let html = '<div class="raw-editor">';
	html += '<div class="raw-header">';
	html += '<h3>Raw JSON (whole document)</h3>';
	html += '<div class="raw-actions">';
	html += '<button class="btn-save" id="btn-apply-raw">Apply</button>';
	html += '<button class="btn-cancel" id="btn-discard-raw">Discard</button>';
	html += '<button class="btn-cancel" id="btn-stay-raw">Stay</button>';
	html += '</div>';
	html += '</div>';

	if (secretCount > 0) {
		html += `<div class="raw-secret-hint">This document contains ${secretCount} opaque secret reference(s). Moving or copying them will fail on save. Deleting a ref removes the secret (requires confirmation).</div>`;
	}

	html += `<textarea id="raw-textarea" rows="20" autocomplete="off" spellcheck="false">${esc(rawText)}</textarea>`;
	html += `<div id="raw-error" class="field-error" role="alert">${rawError ? esc(rawError) : ""}</div>`;
	html += '</div>';

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
	document.getElementById("btn-stay-raw")?.addEventListener("click", () => handlers.onStay());
}

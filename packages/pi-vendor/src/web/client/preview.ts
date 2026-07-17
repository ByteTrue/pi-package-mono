/**
 * Preview — sanitized Before/After comparison and provider change summary.
 * Never renders original secret values.
 */

import type { ProviderManagerState, SecretSlot } from "./state.js";
import { esc } from "./provider-view.js";

export type ProviderChangeSummary = {
	added: string[];
	removed: string[];
	renamed: Array<{ from: string; to: string }>;
	changed: string[];
};

export function computeProviderChangeSummary(
	baseline: Record<string, unknown>,
	current: Record<string, unknown>,
): ProviderChangeSummary {
	const baseKeys = new Set(Object.keys(baseline));
	const currKeys = new Set(Object.keys(current));

	const added = [...currKeys].filter(k => !baseKeys.has(k)).sort();
	const removed = [...baseKeys].filter(k => !currKeys.has(k)).sort();
	const changed: string[] = [];
	const renamed: Array<{ from: string; to: string }> = [];

	// Simple change detection: JSON compare
	const common = [...baseKeys].filter(k => currKeys.has(k));
	for (const key of common) {
		const baseVal = JSON.stringify(baseline[key]);
		const currVal = JSON.stringify(current[key]);
		if (baseVal !== currVal) {
			changed.push(key);
		}
	}

	// Sort for deterministic output
	changed.sort();

	return { added, removed, renamed, changed };
}

function sanitizeForPreview(obj: unknown): unknown {
	if (typeof obj === "string" && obj.startsWith("pi-vendor-secret:")) {
		return "[configured secret]";
	}
	if (Array.isArray(obj)) {
		return obj.map(sanitizeForPreview);
	}
	if (obj && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			result[key] = sanitizeForPreview(value);
		}
		return result;
	}
	return obj;
}

export function renderPreview(
	state: ProviderManagerState,
): string {
	const baselineProviders = (state.baseline as Record<string, unknown>).providers as Record<string, Record<string, unknown>> ?? {};
	const draftProviders = (state.draft as Record<string, unknown>).providers as Record<string, Record<string, unknown>> ?? {};

	const summary = computeProviderChangeSummary(baselineProviders, draftProviders);

	const sanitizedBaseline = sanitizeForPreview(state.baseline);
	const sanitizedDraft = sanitizeForPreview(state.draft);

	let html = '<main class="standalone-view preview" id="main-content">';
	html += '<div class="standalone-header"><div>';
	html += '<p class="workspace-kicker">Review</p><h1>Review draft changes</h1>';
	html += '<p>Secrets stay hidden. Save &amp; close validates this exact draft before writing it.</p></div></div>';

	html += '<section class="preview-summary" aria-label="Change summary">';
	if (summary.added.length > 0) html += `<div class="preview-change preview-added"><strong>Added</strong><span>${summary.added.map(k => esc(k)).join(", ")}</span></div>`;
	if (summary.removed.length > 0) html += `<div class="preview-change preview-removed"><strong>Deleted</strong><span>${summary.removed.map(k => esc(k)).join(", ")}</span></div>`;
	if (summary.changed.length > 0) html += `<div class="preview-change preview-changed"><strong>Changed</strong><span>${summary.changed.map(k => esc(k)).join(", ")}</span></div>`;
	if (summary.added.length === 0 && summary.removed.length === 0 && summary.changed.length === 0) {
		html += '<div class="preview-change preview-none"><strong>No draft changes</strong><span>Return to the draft to make an edit.</span></div>';
	}
	html += '</section>';

	html += '<section class="preview-columns" aria-label="Configuration comparison">';
	html += '<div class="preview-col"><h2>Saved file</h2>';
	html += `<pre>${esc(JSON.stringify(sanitizedBaseline, null, 2))}</pre></div>`;
	html += '<div class="preview-col"><h2>Draft to save</h2>';
	html += `<pre>${esc(JSON.stringify(sanitizedDraft, null, 2))}</pre></div>`;
	html += '</section></main>';
	return html;
}

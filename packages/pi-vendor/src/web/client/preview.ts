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

	let html = '<div class="preview">';
	html += '<h3>Change Preview</h3>';

	// Summary
	html += '<div class="preview-summary">';
	if (summary.added.length > 0) {
		html += `<div class="preview-change preview-added">+ Added: ${summary.added.map(k => esc(k)).join(", ")}</div>`;
	}
	if (summary.removed.length > 0) {
		html += `<div class="preview-change preview-removed">- Removed: ${summary.removed.map(k => esc(k)).join(", ")}</div>`;
	}
	if (summary.changed.length > 0) {
		html += `<div class="preview-change preview-changed">~ Changed: ${summary.changed.map(k => esc(k)).join(", ")}</div>`;
	}
	if (summary.added.length === 0 && summary.removed.length === 0 && summary.changed.length === 0) {
		html += '<div class="preview-change preview-none">No changes detected</div>';
	}
	html += '</div>';

	// Before/After
	const sanitizedBaseline = sanitizeForPreview(state.baseline);
	const sanitizedDraft = sanitizeForPreview(state.draft);

	html += '<div class="preview-columns">';
	html += '<div class="preview-col">';
	html += '<h4>Before</h4>';
	html += `<pre>${esc(JSON.stringify(sanitizedBaseline, null, 2))}</pre>`;
	html += '</div>';
	html += '<div class="preview-col">';
	html += '<h4>After</h4>';
	html += `<pre>${esc(JSON.stringify(sanitizedDraft, null, 2))}</pre>`;
	html += '</div>';
	html += '</div>';

	html += '</div>';
	return html;
}

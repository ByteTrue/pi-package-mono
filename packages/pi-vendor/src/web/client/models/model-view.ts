/**
 * Model view — renders model table, editor, catalog search, and import tray.
 */

import type {
	ModelManagerState,
	ModelRowHandle,
	ImportRow,
	OfficialModelChoice,
	ProviderModelConfig,
	VisualSort,
} from "./state.js";
import {
	listModelRows,
	importRowsFromIds,
	countImportReplaceTargets,
	buildEditorInputModes,
	buildEditorCost,
	type ApiClient,
} from "./state.js";
import type { FieldDescriptor } from "../state.js";
import { esc } from "../provider-view.js";
import { showConfirmDialog } from "../provider-view.js";

// ── Helpers ────────────────────────────────────────────────────────

function escAttr(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function $id(id: string): HTMLElement | null {
	return document.getElementById(id);
}

function listen(id: string, event: string, fn: (e: Event) => void): void {
	$id(id)?.addEventListener(event, fn);
}

// ── Model View Callbacks ───────────────────────────────────────────

export type ModelViewCallbacks = {
	onOpenEditor(handle: ModelRowHandle | null, value?: ProviderModelConfig): void;
	onUpdateEditor(field: string, value: unknown): void;
	onApplyTemplate(official: ProviderModelConfig | OfficialModelChoice["model"] | Record<string, unknown>, status?: string): void;
	onSetFillStatus(status: string, opts?: { error?: boolean; candidates?: Array<{ provider: string; modelId: string; model: Record<string, unknown> }> }): void;
	onCloseEditor(): void;
	onAdd(providerKey: string): void;
	onReplace(providerKey: string, previousId: string, conflict: "reject" | "overwrite-confirmed"): void;
	onDelete(providerKey: string, modelId: string): void;
	onSearch(query: string): void;
	onSort(sort: VisualSort): void;
	onDiscover(providerKey: string): void;
	onImportApply(providerKey: string, conflict: "skip-existing" | "replace-selected"): void;
	onImportSetRows(rows: ImportRow[]): void;
	onImportToggle(id: string): void;
	onImportSelectAll(): void;
	onImportClear(): void;
	onImportChooseCandidate(id: string, choice: OfficialModelChoice): void;
	onImportConfirmDefault(id: string): void;
};

// Track editor focus across full re-renders (each keystroke currently re-renders the app).
let lastEditorFocus: { id: string; start: number | null; end: number | null } | null = null;
let editorSearchTimer: ReturnType<typeof setTimeout> | undefined;
let editorSearchSeq = 0;

function scheduleLiveCatalogSearch(
	rawQuery: string,
	callbacks: ModelViewCallbacks,
	modelApi: ApiClient,
): void {
	if (editorSearchTimer) clearTimeout(editorSearchTimer);
	// Invalidate both a pending debounce and an in-flight response for the old ID.
	editorSearchSeq++;
	const query = rawQuery.trim();
	if (query.length < 2) {
		callbacks.onSetFillStatus("", { candidates: [] });
		return;
	}
	editorSearchTimer = setTimeout(() => {
		void runOfficialFill(query, callbacks, modelApi);
	}, 250);
}

async function runOfficialFill(
	query: string,
	callbacks: ModelViewCallbacks,
	modelApi: ApiClient,
	applyWithConfirm?: (official: Record<string, unknown>, warning?: string) => Promise<void>,
): Promise<void> {
	const seq = ++editorSearchSeq;
	const q = query.trim();
	if (!q) {
		callbacks.onSetFillStatus("Enter a model id first", { error: true, candidates: [] });
		return;
	}
	callbacks.onSetFillStatus("Searching official catalog…", { candidates: [] });
	try {
		const entries = await modelApi.fetchCatalog(q, 25);
		if (seq !== editorSearchSeq) return;
		if (entries.length > 0) {
			const candidates = entries.map((e) => ({
				provider: e.provider,
				modelId: e.modelId,
				model: e.model as Record<string, unknown>,
			}));
			callbacks.onSetFillStatus(
				entries.length === 1
					? "One catalog match — select to fill (required even for a single hit)."
					: `${entries.length} catalog matches — select one.`,
				{ candidates },
			);
			return;
		}
		// Live typing only shows catalog hits; enrich is for explicit Fill button.
		if (!applyWithConfirm) {
			callbacks.onSetFillStatus("No catalog matches", { candidates: [] });
			return;
		}
		callbacks.onSetFillStatus("No catalog hits — enriching…", { candidates: [] });
		const result = await modelApi.fetchEnrich(q);
		if (result.kind === "ready" && result.model) {
			await applyWithConfirm(result.model as Record<string, unknown>, result.warning);
			return;
		}
		if (result.kind === "official-candidates" && result.candidates?.length) {
			const candidates = result.candidates.map((c) => ({
				provider: c.provider,
				modelId: c.modelId,
				model: c.model as Record<string, unknown>,
			}));
			callbacks.onSetFillStatus("Multiple official candidates — select one.", { candidates });
			return;
		}
		callbacks.onSetFillStatus("Could not enrich model", { error: true, candidates: [] });
	} catch (err) {
		if (seq !== editorSearchSeq) return;
		const msg = err instanceof Error ? err.message : "Catalog/enrich failed";
		callbacks.onSetFillStatus(msg, { error: true, candidates: [] });
	}
}

// ── Model Table ────────────────────────────────────────────────────

export function renderModelSection(
	state: ModelManagerState,
	_fieldDescs: FieldDescriptor[],
	_callbacks: ModelViewCallbacks,
): string {
	if (!state.selectedProvider) return "";

	const rows = listModelRows(state.draft, state.selectedProvider, state.modelQuery, state.visualSort);

	let html = '<section class="model-section" aria-labelledby="models-heading">';
	html += '<div class="section-heading model-section-heading"><div>';
	html += '<h2 id="models-heading">Models</h2>';
	html += `<p>${rows.length} visible model${rows.length !== 1 ? "s" : ""}. Search, edit, or add models to this draft.</p>`;
	html += '</div></div>';

	html += '<div class="model-toolbar">';
	html += `<input type="search" id="model-search" placeholder="Filter configured models" value="${escAttr(state.modelQuery)}" autocomplete="off" aria-label="Filter configured models">`;
	html += '<select id="model-sort" aria-label="Sort models">';
	html += `<option value="document"${state.visualSort === "document" ? " selected" : ""}>Document order</option>`;
	html += `<option value="id"${state.visualSort === "id" ? " selected" : ""}>Model ID</option>`;
	html += `<option value="name"${state.visualSort === "name" ? " selected" : ""}>Model name</option>`;
	html += '</select><div class="model-actions">';
	html += '<button class="btn-secondary" id="btn-import-models" type="button">Import from /models</button>';
	html += '<button class="btn-save" id="btn-add-model" type="button">Add model to draft</button>';
	html += '</div></div>';

	if (rows.length === 0) {
		html += '<div class="model-empty">';
		if (state.modelQuery) {
			html += `<strong>No matching models</strong><span>Try a different name or model ID.</span>`;
		} else {
			html += '<strong>No models in this draft</strong><span>Add a model, use an official template, or import from this provider.</span>';
		}
		html += '</div>';
	} else {
		html += '<div class="model-table-wrap"><table class="model-table" aria-label="Models">';
		html += '<thead><tr><th>ID</th><th>Name</th><th>API</th><th>Context</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>';
		for (const row of rows) {
			const model = row.model;
			const id = row.previousId;
			const name = String(model.name ?? "");
			const api = String(model.api ?? "");
			const ctxWin = model.contextWindow ? String(model.contextWindow) : "—";
			const handle: ModelRowHandle = { providerKey: row.providerKey, index: row.index, previousId: id };
			html += '<tr>';
			html += `<td data-label="ID"><code>${esc(id)}</code></td>`;
			html += `<td data-label="Name">${esc(name || "—")}</td>`;
			html += `<td data-label="API"><span class="api-value">${esc(api || "—")}</span></td>`;
			html += `<td data-label="Context" class="numeric-value">${esc(ctxWin)}</td>`;
			html += '<td data-label="Actions" class="model-row-actions">';
			html += `<button class="btn-secondary btn-sm" data-edit="${escAttr(JSON.stringify(handle))}" aria-label="Edit ${escAttr(id)}">Edit</button>`;
			html += `<button class="btn-danger btn-sm" data-delete="${escAttr(JSON.stringify({ providerKey: state.selectedProvider, modelId: id }))}" aria-label="Delete ${escAttr(id)} from draft">Delete model</button>`;
			html += '</td></tr>';
		}
		html += '</tbody></table></div>';
	}

	html += '</section>';
	return html;

}


function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function jsonText(value: unknown): string {
	return value === undefined ? "" : JSON.stringify(value, null, 2);
}

function numberText(value: unknown): string {
	return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function renderModelEditor(
	state: ModelManagerState,
	_fieldDescs: FieldDescriptor[],
	_callbacks: ModelViewCallbacks,
): string {
	if (!state.editor) return "";

	const isNew = !state.editor.handle;
	const title = isNew ? "Add model to draft" : `Edit model in draft: ${esc(String(state.editor.value.id ?? ""))}`;

	let html = '<dialog id="model-editor"><div class="model-editor">';
	html += '<div class="editor-header"><div>';
	html += `<h2>${title}</h2>`;
	html += '<p>Choose an official template or enter values yourself. Nothing is written until you save &amp; close.</p>';
	html += '</div></div>';
	html += `<div class="editor-layout${isNew ? " is-new" : ""}">`;
	html += '<section class="editor-config-pane" aria-label="Model configuration">';

	const editorValue = state.editor.value as Record<string, unknown>;
	const idVal = String(editorValue.id ?? "");
	const nameVal = String(editorValue.name ?? "");
	const apiVal = String(editorValue.api ?? "");
	const baseUrlVal = String(editorValue.baseUrl ?? "");
	const reasoning = editorValue.reasoning === true;
	const ctxWin = numberText(editorValue.contextWindow);
	const maxToks = numberText(editorValue.maxTokens);
	const inputModes = Array.isArray(editorValue.input) ? editorValue.input : [];
	const cost = asRecord(editorValue.cost);

	html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Identity & limits</h3><p>How Pi identifies and calls this model.</p></div>';
	if (!isNew) {
		html += '<div class="field editor-fill-row field-span">';
		html += '<label for="editor-id">Model ID</label><div class="editor-fill-controls">';
		html += `<input type="text" id="editor-id" value="${escAttr(idVal)}" autocomplete="off" placeholder="e.g. claude-fable-5">`;
		html += '<button type="button" class="btn-secondary" id="btn-editor-fill">Search official templates</button></div></div>';
	}
	html += '<div class="editor-form-grid">';
	html += `<div class="field"><label for="editor-name">Display name</label><input type="text" id="editor-name" value="${escAttr(nameVal)}" autocomplete="off"></div>`;
	html += '<div class="field"><label for="editor-api">API</label>';
	html += `<input type="text" id="editor-api" value="${escAttr(apiVal)}" list="api-formats" autocomplete="off">`;
	html += '<datalist id="api-formats">';
	for (const fmt of ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]) html += `<option value="${escAttr(fmt)}">`;
	html += '</datalist></div>';
	html += `<div class="field field-span"><label for="editor-baseUrl">Base URL override</label><input type="text" id="editor-baseUrl" value="${escAttr(baseUrlVal)}" autocomplete="off" placeholder="Use provider base URL"></div>`;
	html += `<div class="field"><label for="editor-contextWindow">Context window</label><input type="text" inputmode="numeric" id="editor-contextWindow" value="${escAttr(ctxWin)}" autocomplete="off"></div>`;
	html += `<div class="field"><label for="editor-maxTokens">Max output tokens</label><input type="text" inputmode="numeric" id="editor-maxTokens" value="${escAttr(maxToks)}" autocomplete="off"></div>`;
	html += '</div></div>';

	html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Capabilities</h3><p>What Pi can send to and request from this model.</p></div>';
	html += '<div class="capability-row">';
	html += `<label class="checkbox-label"><input type="checkbox" id="editor-reasoning"${reasoning ? " checked" : ""}> Supports reasoning</label>`;
	html += '<fieldset class="input-capabilities"><legend>Input</legend>';
	html += `<label class="checkbox-label"><input type="checkbox" id="editor-input-text"${inputModes.includes("text") ? " checked" : ""}> Text</label>`;
	html += `<label class="checkbox-label"><input type="checkbox" id="editor-input-image"${inputModes.includes("image") ? " checked" : ""}> Image</label></fieldset></div>`;
	html += `<div class="field"><label for="editor-thinkingLevelMap">Thinking level map (JSON)</label><textarea id="editor-thinkingLevelMap" rows="4" autocomplete="off" spellcheck="false" placeholder='{"off": null, "xhigh": "xhigh"}'>${esc(jsonText(editorValue.thinkingLevelMap))}</textarea></div></div>`;

	html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Cost</h3><p>USD per million tokens. Zero is a valid value.</p></div>';
	html += '<div class="cost-grid">';
	for (const [key, label] of [["input", "Input"], ["output", "Output"], ["cacheRead", "Cache read"], ["cacheWrite", "Cache write"]] as const) {
		html += `<div class="field"><label for="editor-cost-${key}">${label}</label><input type="text" inputmode="decimal" id="editor-cost-${key}" value="${escAttr(numberText(cost[key]))}" autocomplete="off"></div>`;
	}
	html += '</div>';
	html += `<div class="field"><label for="editor-cost-tiers">Tier overrides (JSON)</label><textarea id="editor-cost-tiers" rows="3" autocomplete="off" spellcheck="false" placeholder="Optional array of tier overrides">${esc(jsonText(cost.tiers))}</textarea></div></div>`;

	html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Compatibility &amp; headers</h3><p>Advanced adapter settings and model-specific headers.</p></div>';
	html += `<div class="field"><label for="editor-compat">Compatibility (JSON)</label><textarea id="editor-compat" rows="4" autocomplete="off" spellcheck="false" placeholder='{"forceAdaptiveThinking": true}'>${esc(jsonText(editorValue.compat))}</textarea></div>`;
	html += `<div class="field"><label for="editor-headers">Headers (JSON)</label><textarea id="editor-headers" rows="4" autocomplete="off" spellcheck="false" placeholder="Optional model-specific headers">${esc(jsonText(editorValue.headers))}</textarea></div></div>`;

	if (state.editor.issues.length > 0) {
		html += '<div class="errors" role="alert">';
		for (const iss of state.editor.issues) html += `<div class="error-msg"><strong>Check this model</strong><span>${esc(iss.message)}</span></div>`;
		html += '</div>';
	}
	html += '</section>';

	const fillStatus = state.editor.fillStatus ?? "";
	const fillErr = state.editor.fillError ? " error-msg" : "";
	const candidates = state.editor.fillCandidates ?? [];
	html += '<aside class="editor-catalog-pane" aria-labelledby="editor-catalog-heading">';
	html += '<div class="editor-catalog-heading"><div><h3 id="editor-catalog-heading">';
	html += isNew ? 'Find an official model' : 'Official configurations';
	html += '</h3>';
	html += `<p>${isNew ? 'Search by model ID, then choose a Pi template. The selected configuration is added to this provider.' : 'Choose the template that matches this provider endpoint.'}</p></div>`;
	if (isNew) {
		html += '<div class="field editor-template-search">';
		html += '<label for="editor-id">Model ID search</label><div class="editor-fill-controls">';
		html += `<input type="search" id="editor-id" value="${escAttr(idVal)}" autocomplete="off" placeholder="e.g. claude-sonnet-4-5" aria-describedby="editor-fill-status">`;
		html += '<button type="button" class="btn-save" id="btn-editor-fill">Search</button></div></div>';
	}
	html += `<span class="candidate-count">${candidates.length || "—"}</span></div>`;
	html += `<div id="editor-fill-status" class="editor-fill-status${fillErr}" aria-live="polite">${esc(fillStatus)}</div>`;
	html += '<div id="editor-fill-results" class="editor-fill-results" tabindex="0" aria-label="Official configuration candidates">';
	if (candidates.length === 0) {
		html += '<div class="editor-catalog-empty"><strong>Search official templates</strong><span>Enter a model ID to find Pi’s built-in templates.</span></div>';
	} else {
		for (let i = 0; i < candidates.length; i++) {
			const entry = candidates[i]!;
			const name = String(entry.model?.name ?? entry.modelId);
			html += '<div class="catalog-entry">';
			html += '<span class="catalog-copy">';
			html += `<strong>${esc(name)}</strong><code>${esc(entry.modelId)}</code>`;
			html += '</span>';
			html += `<span class="catalog-provider">${esc(entry.provider)}</span>`;
			html += `<button type="button" class="btn-secondary btn-sm" data-fill-pick="${i}">Use template</button></div>`;
		}
	}
	html += '</div></aside></div>';

	html += '<div class="dialog-actions">';
	html += '<button class="btn-quiet" id="btn-editor-cancel" type="button">Discard model edits</button>';
	html += `<button class="btn-save" id="btn-editor-save" type="button">${isNew ? "Add to draft" : "Update draft"}</button>`;
	html += '</div></div></dialog>';
	return html;

}

// ── Catalog Search ─────────────────────────────────────────────────

export function renderCatalogSearch(state: ModelManagerState): string {
	if (!state.catalogAvailable) return "";

	let html = '<details class="catalog-section">';
	html += '<summary><span><strong>Official templates</strong><small>Search Pi’s built-in model configurations</small></span></summary>';
	html += '<div class="catalog-body"><div class="catalog-search">';
	html += '<input type="search" id="catalog-query" placeholder="Search model ID or name" autocomplete="off" aria-label="Search official model templates">';
	html += '<button class="btn-secondary" id="btn-catalog-search" type="button">Search templates</button></div>';
	html += '<div id="catalog-results" class="catalog-results" aria-live="polite"></div></div></details>';

	return html;
}

// ── Import Tray ────────────────────────────────────────────────────

export function renderImportTray(state: ModelManagerState): string {
	if (state.importRows.length === 0) return "";

	const selected = state.importRows.filter((r) => r.selected);
	const ready = selected.filter((r) => r.state === "ready");
	const enriching = state.importRows.filter((r) => r.state === "selected-unenriched").length;
	const allSelected = state.importRows.length > 0 && selected.length === state.importRows.length;

	const selectAllLabel = allSelected
		? "Clear selection"
		: state.importRows.length > 100 ? "Select first 100" : "Select all";
	const readyCount = ready.length;
	const actionDisabled = readyCount === 0 ? " disabled" : "";
	const addLabel = readyCount === 1 ? "Add 1 to draft" : `Add ${readyCount} to draft`;
	const replaceLabel = readyCount === 1 ? "Replace 1 in draft" : `Replace ${readyCount} in draft`;

	let html = '<dialog id="import-dialog"><div class="import-dialog">';
	html += '<div class="import-dialog-header"><div><h3 id="import-heading">Import models</h3>';
	html += `<p class="import-status" aria-live="polite">${selected.length} selected · ${readyCount} ready to add · ${state.importRows.length} found`;
	if (enriching > 0) html += ` · resolving ${enriching}`;
	html += "</p></div>";
	html += '<div class="import-toolbar">';
	html += `<button type="button" class="btn-secondary btn-sm" id="btn-import-select-all">${selectAllLabel}</button>`;
	html += '</div></div>';
	html += '<div class="import-table-wrapper" tabindex="0" aria-label="Models discovered from this provider"><table class="import-table">';
	html += '<thead><tr><th class="import-check-col"></th><th>Model</th><th>Status</th><th>Template</th></tr></thead><tbody>';
	for (const row of state.importRows) {
		const checked = row.selected ? " checked" : "";
		const rowClass = row.selected ? " is-selected" : "";
		html += `<tr class="import-row${rowClass}" data-import-row="${escAttr(row.id)}">`;
		html += `<td class="import-check-col"><label class="import-check"><input type="checkbox" data-import-toggle="${escAttr(row.id)}"${checked} aria-label="Select ${escAttr(row.id)}"><span></span></label></td>`;
		html += `<td class="import-id-cell"><code>${esc(row.id)}</code></td>`;
		html += `<td class="import-state-cell import-state-${row.state}">${esc(statusLabel(row.state))}</td><td class="import-detail-cell">`;
		if (row.error) html += `<span class="error-msg">${esc(row.error)}</span>`;
		if (row.model?.name) html += `<span class="import-name">${esc(String(row.model.name))}</span>`;
		if (row.choice?.provider) html += ` <span class="import-provider">${esc(row.choice.provider)}</span>`;
		if (row.state === "ambiguous" && row.candidates?.length) {
			html += '<div class="import-candidates">';
			for (let i = 0; i < row.candidates.length; i++) {
				const c = row.candidates[i]!;
				html += `<button class="btn-secondary btn-sm" data-import-candidate="${escAttr(JSON.stringify({ id: row.id, index: i }))}">Use ${esc(c.provider)} template</button>`;
			}
			html += "</div>";
		}
		if (row.state === "default-warning") html += `<button class="btn-secondary btn-sm" data-import-confirm-default="${escAttr(row.id)}">Use default template</button>`;
		html += "</td></tr>";
	}
	html += '</tbody></table></div><div class="import-actions dialog-actions">';
	html += '<button class="btn-quiet" id="btn-import-cancel" type="button">Close import</button>';
	html += `<button class="btn-secondary" id="btn-import-apply-replace" type="button"${actionDisabled}>${replaceLabel}</button>`;
	html += `<button class="btn-save" id="btn-import-apply-skip" type="button"${actionDisabled}>${addLabel}</button>`;
	html += "</div></div></dialog>";
	return html;
}

function statusLabel(state: ImportRow["state"]): string {
	switch (state) {
		case "selected-unenriched":
			return "Finding template…";
		case "ready":
			return "Ready to add";
		case "ambiguous":
			return "Choose template";
		case "default-warning":
			return "Confirm default";
		case "failed":
			return "Could not resolve";
	}
}


// ── Bind Events ────────────────────────────────────────────────────

export function bindModelEvents(
	state: ModelManagerState,
	callbacks: ModelViewCallbacks,
	modelApi?: ApiClient,
): void {
	// Search
	$id("model-search")?.addEventListener("input", (e) => {
		callbacks.onSearch((e.target as HTMLInputElement).value);
	});

	// Sort
	$id("model-sort")?.addEventListener("change", (e) => {
		callbacks.onSort((e.target as HTMLSelectElement).value as VisualSort);
	});

	// Add model opens the full editor; official search lives inside it.
	$id("btn-add-model")?.addEventListener("click", () => {
		callbacks.onOpenEditor(null);
	});

	// Import is a sibling action on the same Models page — no intermediate chooser.
	$id("btn-import-models")?.addEventListener("click", () => {
		if (state.selectedProvider) callbacks.onDiscover(state.selectedProvider);
	});


	// Edit buttons
	document.querySelectorAll("[data-edit]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const handle = JSON.parse(btn.getAttribute("data-edit")!) as ModelRowHandle;
			callbacks.onOpenEditor(handle);
		});
	});

	// Delete buttons
	document.querySelectorAll("[data-delete]").forEach((btn) => {
		btn.addEventListener("click", async () => {
			const data = JSON.parse(btn.getAttribute("data-delete")!) as { providerKey: string; modelId: string };
			const confirmed = await showConfirmDialog(
				"Delete model from draft",
				`Delete model "${data.modelId}" from this draft? The saved file stays unchanged until you save & close.`,
				"Delete model",
				"Keep model",
			);
			if (confirmed) callbacks.onDelete(data.providerKey, data.modelId);
		});
	});

	// Editor
	if (state.editor) {
		const rememberEditorFocus = (el: HTMLElement) => {
			const id = el.id;
			if (!id) return;
			const input = el as HTMLInputElement | HTMLTextAreaElement;
			const start = typeof input.selectionStart === "number" ? input.selectionStart : null;
			const end = typeof input.selectionEnd === "number" ? input.selectionEnd : null;
			lastEditorFocus = { id, start, end };
		};

		const bindEditorField = (id: string, field: string) => {
			const el = $id(id);
			if (!el) return;
			el.addEventListener("focus", () => rememberEditorFocus(el));
			el.addEventListener("click", () => rememberEditorFocus(el));
			el.addEventListener("keyup", () => rememberEditorFocus(el));
			if (el instanceof HTMLInputElement && el.type === "checkbox") {
				el.addEventListener("change", () => {
					rememberEditorFocus(el);
					callbacks.onUpdateEditor(field, el.checked);
				});
			} else if (el instanceof HTMLTextAreaElement) {
				el.addEventListener("input", () => {
					rememberEditorFocus(el);
					const text = el.value;
					if (text.trim() === "") {
						callbacks.onUpdateEditor(field, undefined);
						return;
					}
					try {
						callbacks.onUpdateEditor(field, JSON.parse(text));
					} catch {
						/* keep typing invalid JSON */
					}
				});
			} else if (field === "contextWindow" || field === "maxTokens") {
				el.addEventListener("input", () => {
					rememberEditorFocus(el);
					const val = (el as HTMLInputElement).value;
					callbacks.onUpdateEditor(field, val === "" ? undefined : Number(val));
				});
			} else {
				el.addEventListener("input", () => {
					rememberEditorFocus(el);
					const val = (el as HTMLInputElement).value;
					callbacks.onUpdateEditor(field, val || undefined);
					if (field === "id" && modelApi) {
						scheduleLiveCatalogSearch(val, callbacks, modelApi);
					}
				});
			}
		};

		// Restore focus after full dialog re-create.
		if (lastEditorFocus) {
			const el = $id(lastEditorFocus.id) as HTMLInputElement | HTMLTextAreaElement | null;
			if (el) {
				el.focus();
				if (
					lastEditorFocus.start != null &&
					lastEditorFocus.end != null &&
					typeof el.setSelectionRange === "function"
				) {
					try {
						el.setSelectionRange(lastEditorFocus.start, lastEditorFocus.end);
					} catch {
						/* ignore non-text controls */
					}
				}
			}
		}

		bindEditorField("editor-id", "id");
		bindEditorField("editor-name", "name");
		bindEditorField("editor-api", "api");
		bindEditorField("editor-baseUrl", "baseUrl");
		bindEditorField("editor-reasoning", "reasoning");
		bindEditorField("editor-contextWindow", "contextWindow");
		bindEditorField("editor-maxTokens", "maxTokens");
		bindEditorField("editor-thinkingLevelMap", "thinkingLevelMap");
		bindEditorField("editor-compat", "compat");
		bindEditorField("editor-headers", "headers");

		const updateInputModes = () => {
			const modes = buildEditorInputModes(
				($id("editor-input-text") as HTMLInputElement | null)?.checked === true,
				($id("editor-input-image") as HTMLInputElement | null)?.checked === true,
			);
			callbacks.onUpdateEditor("input", modes);
		};
		for (const id of ["editor-input-text", "editor-input-image"]) {
			const el = $id(id) as HTMLInputElement | null;
			el?.addEventListener("change", () => {
				rememberEditorFocus(el);
				updateInputModes();
			});
		}

		const updateCost = () => {
			try {
				const values: Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite", string>> = {};
				for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
					values[key] = ($id(`editor-cost-${key}`) as HTMLInputElement | null)?.value ?? "";
				}
				const tiersText = ($id("editor-cost-tiers") as HTMLTextAreaElement | null)?.value ?? "";
				callbacks.onUpdateEditor("cost", buildEditorCost(values, tiersText));
			} catch {
				// Keep incomplete numeric/JSON input visible; commit after it becomes valid.
			}
		};
		for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
			const el = $id(`editor-cost-${key}`) as HTMLInputElement | null;
			el?.addEventListener("input", () => {
				rememberEditorFocus(el);
				updateCost();
			});
		}
		const tiers = $id("editor-cost-tiers") as HTMLTextAreaElement | null;
		tiers?.addEventListener("input", () => {
			rememberEditorFocus(tiers);
			updateCost();
		});

		listen("btn-editor-save", "click", () => {
			if (state.editor?.handle) {
				callbacks.onReplace(state.editor.handle.providerKey, state.editor.handle.previousId, "reject");
			} else {
				callbacks.onAdd(state.selectedProvider ?? "");
			}
		});

		listen("btn-editor-cancel", "click", () => {
			lastEditorFocus = null;
			if (editorSearchTimer) clearTimeout(editorSearchTimer);
			callbacks.onCloseEditor();
		});

		// Official fill: catalog first, then enrich. Live typing reuses catalog search only.
		if (modelApi) {
			const applyWithConfirm = async (official: Record<string, unknown>, warning?: string) => {
				if (state.editor?.handle) {
					const ok = await showConfirmDialog(
						"Apply official template",
						"Replace template fields with this official template? Your headers and configured secrets stay unchanged.",
						"Apply template",
						"Keep current values",
					);
					if (!ok) return;
				}
				callbacks.onApplyTemplate(
					official,
					warning ?? "Official template applied to this draft.",
				);
			};

			listen("btn-editor-fill", "click", () => {
				const idInput = $id("editor-id") as HTMLInputElement | null;
				const query = (idInput?.value ?? String(state.editor?.value.id ?? "")).trim();
				void runOfficialFill(query, callbacks, modelApi, applyWithConfirm);
			});

			document.querySelectorAll("[data-fill-pick]").forEach((btn) => {
				btn.addEventListener("click", () => {
					const idx = Number((btn as HTMLElement).getAttribute("data-fill-pick"));
					const entry = (state.editor?.fillCandidates ?? [])[idx];
					if (!entry) return;
					void applyWithConfirm({ ...entry.model, id: entry.modelId });
				});
			});
		} else {
			listen("btn-editor-fill", "click", () => {
				callbacks.onSetFillStatus("Official templates are unavailable. Enter the model details manually.", { error: true, candidates: [] });
			});
		}
	}

	// Catalog search — open editor with closed DTO value (no delayed multi-field race).
	if (modelApi && state.catalogAvailable) {
		listen("btn-catalog-search", "click", async () => {
			const query = ($id("catalog-query") as HTMLInputElement)?.value ?? "";
			if (!query) return;
			const resultsDiv = $id("catalog-results");
			if (!resultsDiv) return;
			resultsDiv.innerHTML = '<div class="catalog-loading" aria-live="polite">Searching the official catalog…</div>';
			try {
				const entries = await modelApi.fetchCatalog(query, 50);
				let html = "";
				for (const entry of entries) {
					const name = String(entry.model?.name ?? entry.modelId);
					html += `<div class="catalog-entry" data-catalog="${escAttr(JSON.stringify(entry))}">`;
					html += `<span class="catalog-id"><code>${esc(entry.modelId)}</code></span>`;
					html += `<span class="catalog-name">${esc(name)}</span>`;
					html += `<span class="catalog-provider">${esc(entry.provider)}</span>`;
					html += '<button class="btn-secondary btn-sm" type="button">Use template</button>';
					html += "</div>";
				}
				if (entries.length === 0) html = '<div class="catalog-empty">No official template matched. Try another model ID or name.</div>';
				resultsDiv.innerHTML = html;

				resultsDiv.querySelectorAll("[data-catalog]").forEach((div) => {
					const btn = div.querySelector("button");
					btn?.addEventListener("click", () => {
						const entry = JSON.parse(div.getAttribute("data-catalog")!) as OfficialModelChoice;
						// Closed DTO only — never open with raw spread.
						const model: ProviderModelConfig = { id: entry.modelId };
						for (const [k, v] of Object.entries(entry.model)) {
							if (k === "id") continue;
							(model as Record<string, unknown>)[k] = v;
						}
						model.id = entry.modelId;
						callbacks.onOpenEditor(null, model);
					});
				});
			} catch {
				resultsDiv.innerHTML = '<div class="error-msg"><strong>Could not search official templates</strong><span>Try again, or enter the model details manually.</span></div>';
			}
		});
	}

	const runDiscover = async () => {
		if (!state.selectedProvider || !modelApi) return;
		const importBtn = $id("btn-import-models");
		const originalLabel = importBtn?.textContent ?? "Import from /models";
		if (importBtn) {
			importBtn.textContent = "Checking /models…";
			importBtn.setAttribute("disabled", "");
		}

		try {
			const providers = (state.draft as Record<string, unknown>).providers as Record<
				string,
				Record<string, unknown>
			>;
			const provider = providers[state.selectedProvider] ?? {};
			const result = await modelApi.fetchDiscover(state.selectedProvider, provider);
			const rows = importRowsFromIds(result.ids);
			callbacks.onImportSetRows(rows);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Could not list models from this provider";
			const importArea = document.querySelector(".model-section");
			if (importArea) {
				importArea.querySelectorAll(".discover-error").forEach((el) => el.remove());
				const errDiv = document.createElement("div");
				errDiv.className = "error-msg discover-error";
			errDiv.innerHTML = `<strong>Could not list models from this provider</strong><span>${esc(msg)} Check the provider URL and credentials, then try again.</span>`;
				importArea.appendChild(errDiv);
			}
		} finally {
			if (importBtn) {
				importBtn.textContent = originalLabel;
				importBtn.removeAttribute("disabled");
			}
		}
	};

	(window as unknown as { __piVendorRunDiscover?: () => Promise<void> }).__piVendorRunDiscover = runDiscover;

	// Import dialog events are rebound by app.patchImportDialog after each import-only update.
}

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
	html += `<p>${rows.length} visible model${rows.length !== 1 ? "s" : ""}. Search, edit, or add a configuration.</p>`;
	html += '</div></div>';

	html += '<div class="model-toolbar">';
	html += `<input type="search" id="model-search" placeholder="Filter configured models" value="${escAttr(state.modelQuery)}" autocomplete="off" aria-label="Filter configured models">`;
	html += '<select id="model-sort" aria-label="Sort models">';
	html += `<option value="document"${state.visualSort === "document" ? " selected" : ""}>Document order</option>`;
	html += `<option value="id"${state.visualSort === "id" ? " selected" : ""}>Model ID</option>`;
	html += `<option value="name"${state.visualSort === "name" ? " selected" : ""}>Model name</option>`;
	html += '</select><div class="model-actions">';
	html += '<button class="btn-save" id="btn-add-model" type="button">Add model</button>';
	html += '</div></div>';

	if (rows.length === 0) {
		html += '<div class="model-empty">';
		if (state.modelQuery) {
			html += `<strong>No matching models</strong><span>Try a different name or model ID.</span>`;
		} else {
			html += '<strong>No models configured</strong><span>Add a model, find one in the official catalog, or import from this provider.</span>';
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
			html += `<button class="btn-danger btn-sm" data-delete="${escAttr(JSON.stringify({ providerKey: state.selectedProvider, modelId: id }))}" aria-label="Delete ${escAttr(id)}">Delete</button>`;
			html += '</td></tr>';
		}
		html += '</tbody></table></div>';
	}

	html += '</section>';
	return html;

}

function renderAddModelChooser(): string {
	let html = '<dialog id="add-model-chooser"><form method="dialog" class="add-source-form">';
	html += '<h3>Add model</h3>';
	html += '<p>Choose how you want to start this model configuration.</p>';
	html += '<div class="add-source-list">';
	html += '<button type="button" class="add-source-option" data-add-source="custom"><strong>Configure a model</strong><span>Open the model editor. Search official templates or type the details yourself.</span></button>';
	html += '<button type="button" class="add-source-option" data-add-source="import"><strong>Import from /models</strong><span>List models from this provider’s OpenAI-compatible endpoint.</span></button>';
	html += '</div>';
	html += '<div class="dialog-actions"><button type="submit" class="btn-quiet" value="cancel">Cancel</button></div>';
	html += '</form></dialog>';
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
	const title = isNew ? "Add Model" : `Edit Model: ${esc(String(state.editor.value.id ?? ""))}`;

	let html = '<dialog id="model-editor"><div class="model-editor">';
	html += '<div class="editor-header"><div>';
	html += `<h2>${title}</h2>`;
	html += `<p>${isNew ? "Start with an ID, then choose an official configuration or enter the details yourself." : "Changes stay in this draft until you save the session."}</p>`;
	html += '</div></div>';
	html += '<div class="editor-layout">';
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
	html += '<div class="field editor-fill-row field-span">';
	html += '<label for="editor-id">Model ID</label><div class="editor-fill-controls">';
	html += `<input type="text" id="editor-id" value="${escAttr(idVal)}" autocomplete="off" placeholder="e.g. claude-fable-5">`;
	html += '<button type="button" class="btn-secondary" id="btn-editor-fill">Find official config</button></div></div>';
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

	html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Capabilities</h3><p>Inputs and reasoning behavior exposed to Pi.</p></div>';
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

	html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Compatibility & headers</h3><p>Advanced Pi adapter behavior and model-specific headers.</p></div>';
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
	html += '<div class="editor-catalog-heading"><div><h3 id="editor-catalog-heading">Official configurations</h3>';
	html += '<p>Choose the provider template that matches your endpoint.</p></div>';
	html += `<span class="candidate-count">${candidates.length || "—"}</span></div>`;
	html += `<div id="editor-fill-status" class="editor-fill-status${fillErr}" aria-live="polite">${esc(fillStatus)}</div>`;
	html += '<div id="editor-fill-results" class="editor-fill-results" tabindex="0" aria-label="Official configuration candidates">';
	if (candidates.length === 0) {
		html += '<div class="editor-catalog-empty"><strong>No results yet</strong><span>Enter a model ID to search Pi’s built-in catalog.</span></div>';
	} else {
		for (let i = 0; i < candidates.length; i++) {
			const entry = candidates[i]!;
			const name = String(entry.model?.name ?? entry.modelId);
			html += '<div class="catalog-entry">';
			html += '<span class="catalog-copy">';
			html += `<strong>${esc(name)}</strong><code>${esc(entry.modelId)}</code>`;
			html += '</span>';
			html += `<span class="catalog-provider">${esc(entry.provider)}</span>`;
			html += `<button type="button" class="btn-secondary btn-sm" data-fill-pick="${i}">Use</button></div>`;
		}
	}
	html += '</div></aside></div>';

	html += '<div class="dialog-actions">';
	html += '<button class="btn-quiet" id="btn-editor-cancel" type="button">Keep editing later</button>';
	html += `<button class="btn-save" id="btn-editor-save" type="button">${isNew ? "Add model" : "Save model"}</button>`;
	html += '</div></div></dialog>';
	return html;

}

// ── Catalog Search ─────────────────────────────────────────────────

export function renderCatalogSearch(state: ModelManagerState): string {
	if (!state.catalogAvailable) return "";

	let html = '<details class="catalog-section">';
	html += '<summary><span><strong>Official catalog</strong><small>Start a new model from a Pi template</small></span></summary>';
	html += '<div class="catalog-body"><div class="catalog-search">';
	html += '<input type="search" id="catalog-query" placeholder="Search official models" autocomplete="off" aria-label="Search official models">';
	html += '<button class="btn-secondary" id="btn-catalog-search" type="button">Search</button></div>';
	html += '<div id="catalog-results" class="catalog-results" aria-live="polite"></div></div></details>';

	return html;
}

// ── Import Tray ────────────────────────────────────────────────────

export function renderImportTray(state: ModelManagerState): string {
	if (state.importRows.length === 0) return "";

	const selected = state.importRows.filter((r) => r.selected);
	const ready = selected.filter((r) => r.state === "ready");

	let html = '<dialog id="import-dialog"><div class="import-dialog">';
	html += '<div class="import-dialog-header"><div><h3 id="import-heading">Import from /models</h3>';
	html += `<p class="import-status" aria-live="polite">${selected.length} selected · ${ready.length} ready · max 100</p></div></div>`;
	html += '<div class="import-table-wrapper" tabindex="0" aria-label="Discovered models"><table class="import-table">';
	html += '<thead><tr><th></th><th>ID</th><th>Status</th><th>Details</th></tr></thead><tbody>';
	for (const row of state.importRows) {
		const checked = row.selected ? " checked" : "";
		html += "<tr>";
		html += `<td><input type="checkbox" data-import-toggle="${escAttr(row.id)}"${checked} aria-label="Select ${escAttr(row.id)}"></td>`;
		html += `<td><code>${esc(row.id)}</code></td><td class="import-state-${row.state}">${esc(row.state)}</td><td>`;
		if (row.error) html += `<span class="error-msg">${esc(row.error)}</span>`;
		if (row.model?.name) html += esc(String(row.model.name));
		if (row.choice?.provider) html += ` (${esc(row.choice.provider)})`;
		if (row.state === "ambiguous" && row.candidates?.length) {
			html += '<div class="import-candidates">';
			for (let i = 0; i < row.candidates.length; i++) {
				const c = row.candidates[i]!;
				html += `<button class="btn-secondary btn-sm" data-import-candidate="${escAttr(JSON.stringify({ id: row.id, index: i }))}">${esc(c.provider)}/${esc(c.modelId)}</button>`;
			}
			html += "</div>";
		}
		if (row.state === "default-warning") html += `<button class="btn-secondary btn-sm" data-import-confirm-default="${escAttr(row.id)}">Use default</button>`;
		html += "</td></tr>";
	}
	html += '</tbody></table></div><div class="import-actions dialog-actions">';
	html += '<button class="btn-quiet" id="btn-import-cancel" type="button">Cancel import</button>';
	html += '<button class="btn-secondary" id="btn-import-apply-replace" type="button">Replace selected</button>';
	html += '<button class="btn-save" id="btn-import-apply-skip" type="button">Add selected</button>';
	html += "</div></div></dialog>";
	return html;
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

	// Add model — source chooser
	$id("btn-add-model")?.addEventListener("click", () => {
		document.querySelectorAll("#add-model-chooser").forEach((el) => el.remove());
		document.body.insertAdjacentHTML("beforeend", renderAddModelChooser());
		const dialog = document.getElementById("add-model-chooser") as HTMLDialogElement | null;
		dialog?.showModal();

		const closeChooser = () => {
			dialog?.close();
			dialog?.remove();
		};

		dialog?.querySelectorAll("[data-add-source]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const source = btn.getAttribute("data-add-source");
				closeChooser();
				if (source === "import") {
					if (state.selectedProvider) callbacks.onDiscover(state.selectedProvider);
					return;
				}
				callbacks.onOpenEditor(null);
			});
		});
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
				"Delete Model",
				`Delete model "${data.modelId}"?`,
				"Delete",
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
						"Fill from official",
						"Replace template fields (name, api, context, …) with the official catalog values? Headers and secrets stay unchanged.",
						"Fill",
					);
					if (!ok) return;
				}
				callbacks.onApplyTemplate(
					official,
					warning ?? "Filled template fields from official source.",
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
				callbacks.onSetFillStatus("Catalog API client not ready", { error: true, candidates: [] });
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
					html += '<button class="btn-secondary btn-sm" type="button">Use</button>';
					html += "</div>";
				}
				if (entries.length === 0) html = '<div class="catalog-empty">No official models matched this search. Try another ID.</div>';
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
				resultsDiv.innerHTML = '<div class="error-msg"><strong>Catalog unavailable</strong><span>Try again, or enter the model details manually.</span></div>';
			}
		});
	}

	const runDiscover = async () => {
		if (!state.selectedProvider || !modelApi) return;
		const addBtn = $id("btn-add-model");
		const originalLabel = addBtn?.textContent ?? "Add model";
		if (addBtn) {
			addBtn.textContent = "Checking /models…";
			addBtn.setAttribute("disabled", "");
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
			const msg = err instanceof Error ? err.message : "Discovery failed";
			const importArea = document.querySelector(".model-section");
			if (importArea) {
				importArea.querySelectorAll(".discover-error").forEach((el) => el.remove());
				const errDiv = document.createElement("div");
				errDiv.className = "error-msg discover-error";
				errDiv.innerHTML = `<strong>Could not import models</strong><span>${esc(msg)}</span>`;
				importArea.appendChild(errDiv);
			}
		} finally {
			if (addBtn) {
				addBtn.textContent = originalLabel;
				addBtn.removeAttribute("disabled");
			}
		}
	};

	// Import option in chooser calls onDiscover; app wires it to this runner.
	// Store on callbacks bag via side channel: return void, app uses bindModelEvents after setting onDiscover to invoke discover from here.
	// Attach listener for synthetic discover trigger used by onDiscover wiring.
	document.getElementById("btn-add-model")?.setAttribute("data-discover-ready", "1");
	// Expose for app.ts onDiscover — minimal bridge without restructuring callbacks this pass.
	(window as unknown as { __piVendorRunDiscover?: () => Promise<void> }).__piVendorRunDiscover = runDiscover;

	// Import tray events
	listen("btn-import-apply-skip", "click", () => {
		callbacks.onImportApply(state.selectedProvider ?? "", "skip-existing");
	});
	listen("btn-import-apply-replace", "click", async () => {
		const pk = state.selectedProvider ?? "";
		const { modelCount, secretCount } = countImportReplaceTargets(
			state.draft,
			pk,
			state.importRows,
			state.secretSlots,
		);
		const msg =
			secretCount > 0
				? `Replace ${modelCount} existing model(s)? Removes ${secretCount} known secret(s) under those targets.`
				: `Replace ${modelCount} existing model(s) with imported versions?`;
		const confirmed = await showConfirmDialog("Replace Models", msg, "Replace");
		if (confirmed) callbacks.onImportApply(pk, "replace-selected");
	});
	listen("btn-import-cancel", "click", () => {
		callbacks.onImportClear();
	});

	// Import toggle checkboxes
	document.querySelectorAll("[data-import-toggle]").forEach((cb) => {
		cb.addEventListener("change", () => {
			const id = cb.getAttribute("data-import-toggle")!;
			callbacks.onImportToggle(id);
		});
	});

	// Ambiguity candidate choice
	document.querySelectorAll("[data-import-candidate]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const data = JSON.parse(btn.getAttribute("data-import-candidate")!) as { id: string; index: number };
			const row = state.importRows.find((r) => r.id === data.id);
			const choice = row?.candidates?.[data.index];
			if (choice) callbacks.onImportChooseCandidate(data.id, choice);
		});
	});

	// Default warning confirm
	document.querySelectorAll("[data-import-confirm-default]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const id = btn.getAttribute("data-import-confirm-default")!;
			callbacks.onImportConfirmDefault(id);
		});
	});
}

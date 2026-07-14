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
	type ApiClient as ModelApiClient,
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

// ── Model Table ────────────────────────────────────────────────────

export function renderModelSection(
	state: ModelManagerState,
	_fieldDescs: FieldDescriptor[],
	_callbacks: ModelViewCallbacks,
): string {
	if (!state.selectedProvider) return "";

	const rows = listModelRows(state.draft, state.selectedProvider, state.modelQuery, state.visualSort);

	let html = '<div class="model-section">';
	html += "<h3>Models</h3>";

	// Toolbar
	html += '<div class="model-toolbar">';
	html += `<input type="search" id="model-search" placeholder="Search models…" value="${escAttr(state.modelQuery)}" autocomplete="off">`;
	html += '<select id="model-sort" aria-label="Sort models">';
	html += `<option value="document"${state.visualSort === "document" ? " selected" : ""}>Default order</option>`;
	html += `<option value="id"${state.visualSort === "id" ? " selected" : ""}>By ID</option>`;
	html += `<option value="name"${state.visualSort === "name" ? " selected" : ""}>By name</option>`;
	html += "</select>";
	html += '<div class="model-actions">';
	html += '<button class="btn-save" id="btn-add-model">Add model</button>';
	html += '<button class="btn-raw" id="btn-discover">Import /models</button>';
	html += "</div>";
	html += "</div>";

	// Table
	if (rows.length === 0) {
		html += '<div class="model-empty">';
		if (state.modelQuery) {
			html += `No models matching "${esc(state.modelQuery)}"`;
		} else {
			html += "No models configured. Add a model, search official catalog, or import from /models.";
		}
		html += "</div>";
	} else {
		html += '<table class="model-table" role="table" aria-label="Models">';
		html += "<thead><tr>";
		html += "<th>ID</th><th>Name</th><th>API</th><th>Context</th><th>Actions</th>";
		html += "</tr></thead><tbody>";

		for (const row of rows) {
			const model = row.model;
			const id = row.previousId;
			const name = String(model.name ?? "");
			const api = String(model.api ?? "");
			const ctxWin = model.contextWindow ? String(model.contextWindow) : "";
			const handle: ModelRowHandle = {
				providerKey: row.providerKey,
				index: row.index,
				previousId: id,
			};

			html += "<tr>";
			html += `<td><code>${esc(id)}</code></td>`;
			html += `<td>${esc(name)}</td>`;
			html += `<td>${esc(api)}</td>`;
			html += `<td>${esc(ctxWin)}</td>`;
			html += '<td class="model-row-actions">';
			html += `<button class="btn-rename" data-edit="${escAttr(JSON.stringify(handle))}" aria-label="Edit ${escAttr(id)}">Edit</button>`;
			html += `<button class="btn-delete" data-delete="${escAttr(JSON.stringify({ providerKey: state.selectedProvider, modelId: id }))}" aria-label="Delete ${escAttr(id)}">Delete</button>`;
			html += "</td>";
			html += "</tr>";
		}

		html += "</tbody></table>";
	}

	html += "</div>";
	return html;
}

export function renderModelEditor(
	state: ModelManagerState,
	_fieldDescs: FieldDescriptor[],
	_callbacks: ModelViewCallbacks,
): string {
	if (!state.editor) return "";

	const isNew = !state.editor.handle;
	const title = isNew ? "Add Model" : `Edit Model: ${esc(String(state.editor.value.id ?? ""))}`;

	let html = '<dialog id="model-editor" open><div class="model-editor">';
	html += `<h3>${title}</h3>`;

	const idVal = String(state.editor.value.id ?? "");
	html += '<div class="field editor-fill-row">';
	html += '<label for="editor-id">ID</label>';
	html += '<div class="editor-fill-controls">';
	html += `<input type="text" id="editor-id" value="${escAttr(idVal)}" autocomplete="off" placeholder="model id">`;
	html += '<button type="button" class="btn-save btn-sm" id="btn-editor-fill">Fill from official</button>';
	html += "</div>";
	const fillStatus = state.editor.fillStatus ?? "";
	const fillErr = state.editor.fillError ? " error-msg" : "";
	html += `<div id="editor-fill-status" class="editor-fill-status${fillErr}" aria-live="polite">${esc(fillStatus)}</div>`;
	html += '<div id="editor-fill-results" class="editor-fill-results">';
	const candidates = state.editor.fillCandidates ?? [];
	for (let i = 0; i < candidates.length; i++) {
		const e = candidates[i]!;
		const name = String(e.model?.name ?? e.modelId);
		html += `<div class="catalog-entry">`;
		html += `<span class="catalog-id"><code>${esc(e.modelId)}</code></span>`;
		html += `<span class="catalog-name">${esc(name)}</span>`;
		html += `<span class="catalog-provider">${esc(e.provider)}</span>`;
		html += `<button type="button" class="btn-save btn-sm" data-fill-pick="${i}">Select</button>`;
		html += "</div>";
	}
	html += "</div>";
	html += "</div>";

	const nameVal = String(state.editor.value.name ?? "");
	html += '<div class="field">';
	html += '<label for="editor-name">Name</label>';
	html += `<input type="text" id="editor-name" value="${escAttr(nameVal)}" autocomplete="off">`;
	html += "</div>";

	const apiVal = String(state.editor.value.api ?? "");
	html += '<div class="field">';
	html += '<label for="editor-api">API</label>';
	html += `<input type="text" id="editor-api" value="${escAttr(apiVal)}" list="api-formats" autocomplete="off">`;
	html += '<datalist id="api-formats">';
	for (const fmt of ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]) {
		html += `<option value="${escAttr(fmt)}">`;
	}
	html += "</datalist>";
	html += "</div>";

	const reasoning = state.editor.value.reasoning === true;
	html += '<div class="field">';
	html += '<label class="checkbox-label">';
	html += `<input type="checkbox" id="editor-reasoning"${reasoning ? " checked" : ""}> Reasoning`;
	html += "</label>";
	html += "</div>";

	const ctxWin = state.editor.value.contextWindow ? String(state.editor.value.contextWindow) : "";
	html += '<div class="field">';
	html += '<label for="editor-contextWindow">Context window</label>';
	html += `<input type="text" id="editor-contextWindow" value="${escAttr(ctxWin)}" autocomplete="off">`;
	html += "</div>";

	const maxToks = state.editor.value.maxTokens ? String(state.editor.value.maxTokens) : "";
	html += '<div class="field">';
	html += '<label for="editor-maxTokens">Max tokens</label>';
	html += `<input type="text" id="editor-maxTokens" value="${escAttr(maxToks)}" autocomplete="off">`;
	html += "</div>";

	const headersVal = state.editor.value.headers ? JSON.stringify(state.editor.value.headers, null, 2) : "";
	html += '<div class="field">';
	html += '<label for="editor-headers">Headers (JSON)</label>';
	html += `<textarea id="editor-headers" rows="3" autocomplete="off">${esc(headersVal)}</textarea>`;
	html += "</div>";

	if (state.editor.issues.length > 0) {
		html += '<div class="errors">';
		for (const iss of state.editor.issues) {
			html += `<div class="error-msg">${esc(iss.message)}</div>`;
		}
		html += "</div>";
	}

	html += '<div class="dialog-actions">';
	html += '<button class="btn-cancel" id="btn-editor-cancel">Cancel</button>';
	html += `<button class="btn-save" id="btn-editor-save">${isNew ? "Add" : "Save"}</button>`;
	html += "</div>";

	html += "</div></dialog>";

	return html;
}

// ── Catalog Search ─────────────────────────────────────────────────

export function renderCatalogSearch(state: ModelManagerState): string {
	if (!state.catalogAvailable) return "";

	let html = '<div class="catalog-section">';
	html += "<h4>Official Catalog</h4>";
	html += '<div class="catalog-search">';
	html += '<input type="search" id="catalog-query" placeholder="Search official models…" autocomplete="off">';
	html += '<button class="btn-save" id="btn-catalog-search">Search</button>';
	html += "</div>";
	html += '<div id="catalog-results" class="catalog-results"></div>';
	html += "</div>";

	return html;
}

// ── Import Tray ────────────────────────────────────────────────────

export function renderImportTray(state: ModelManagerState): string {
	if (state.importRows.length === 0) return "";

	const selected = state.importRows.filter((r) => r.selected);
	const ready = selected.filter((r) => r.state === "ready");

	let html = '<div class="import-tray">';
	html += "<h4>Import /models</h4>";
	html += `<div class="import-status" aria-live="polite">${selected.length} selected, ${ready.length} ready (max 100)</div>`;

	html += '<div class="import-table-wrapper">';
	html += '<table class="import-table">';
	html += "<thead><tr><th></th><th>ID</th><th>Status</th><th>Info</th></tr></thead>";
	html += "<tbody>";

	for (const row of state.importRows) {
		const checked = row.selected ? " checked" : "";
		html += "<tr>";
		html += `<td><input type="checkbox" data-import-toggle="${escAttr(row.id)}"${checked} aria-label="Select ${escAttr(row.id)}"></td>`;
		html += `<td><code>${esc(row.id)}</code></td>`;
		html += `<td class="import-state-${row.state}">${esc(row.state)}</td>`;
		html += "<td>";
		if (row.error) html += `<span class="error-msg">${esc(row.error)}</span>`;
		if (row.model?.name) html += esc(String(row.model.name));
		if (row.choice?.provider) html += ` (${esc(row.choice.provider)})`;
		if (row.state === "ambiguous" && row.candidates?.length) {
			html += '<div class="import-candidates">';
			for (let i = 0; i < row.candidates.length; i++) {
				const c = row.candidates[i]!;
				html += `<button class="btn-raw btn-sm" data-import-candidate="${escAttr(JSON.stringify({ id: row.id, index: i }))}">${esc(c.provider)}/${esc(c.modelId)}</button>`;
			}
			html += "</div>";
		}
		if (row.state === "default-warning") {
			html += `<button class="btn-save btn-sm" data-import-confirm-default="${escAttr(row.id)}">Confirm default</button>`;
		}
		html += "</td>";
		html += "</tr>";
	}

	html += "</tbody></table>";
	html += "</div>";

	html += '<div class="import-actions">';
	html += '<button class="btn-save" id="btn-import-apply-skip">Apply (skip existing)</button>';
	html += '<button class="btn-raw" id="btn-import-apply-replace">Apply (replace existing)</button>';
	html += '<button class="btn-cancel" id="btn-import-cancel">Cancel</button>';
	html += "</div>";
	html += "</div>";

	return html;
}

// ── Bind Events ────────────────────────────────────────────────────

export function bindModelEvents(
	state: ModelManagerState,
	callbacks: ModelViewCallbacks,
	modelApi?: ModelApiClient,
): void {
	// Search
	$id("model-search")?.addEventListener("input", (e) => {
		callbacks.onSearch((e.target as HTMLInputElement).value);
	});

	// Sort
	$id("model-sort")?.addEventListener("change", (e) => {
		callbacks.onSort((e.target as HTMLSelectElement).value as VisualSort);
	});

	// Add model button
	$id("btn-add-model")?.addEventListener("click", () => {
		callbacks.onOpenEditor(null);
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
		const bindEditorField = (id: string, field: string) => {
			const el = $id(id);
			if (!el) return;
			if (el instanceof HTMLInputElement && el.type === "checkbox") {
				el.addEventListener("change", () => callbacks.onUpdateEditor(field, el.checked));
			} else if (el instanceof HTMLTextAreaElement) {
				el.addEventListener("input", () => {
					const val = el.value.trim();
					if (!val) callbacks.onUpdateEditor(field, undefined);
					else {
						try {
							callbacks.onUpdateEditor(field, JSON.parse(val));
						} catch {
							/* invalid JSON */
						}
					}
				});
			} else {
				el.addEventListener("input", () => {
					const val = (el as HTMLInputElement).value;
					callbacks.onUpdateEditor(field, val || undefined);
				});
			}
		};

		bindEditorField("editor-id", "id");
		bindEditorField("editor-name", "name");
		bindEditorField("editor-api", "api");
		bindEditorField("editor-reasoning", "reasoning");
		bindEditorField("editor-contextWindow", "contextWindow");
		bindEditorField("editor-maxTokens", "maxTokens");
		bindEditorField("editor-headers", "headers");

		listen("btn-editor-save", "click", () => {
			if (state.editor?.handle) {
				callbacks.onReplace(state.editor.handle.providerKey, state.editor.handle.previousId, "reject");
			} else {
				callbacks.onAdd(state.selectedProvider ?? "");
			}
		});

		listen("btn-editor-cancel", "click", () => callbacks.onCloseEditor());

		// Official fill: catalog first, then enrich. State holds status/candidates so re-render keeps feedback.
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
				void (async () => {
					const idInput = $id("editor-id") as HTMLInputElement | null;
					const query = (idInput?.value ?? String(state.editor?.value.id ?? "")).trim();
					if (!query) {
						callbacks.onSetFillStatus("Enter a model id first", { error: true, candidates: [] });
						return;
					}
					callbacks.onSetFillStatus("Searching official catalog…", { candidates: [] });
					try {
						const entries = await modelApi.fetchCatalog(query, 25);
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

						callbacks.onSetFillStatus("No catalog hits — enriching…", { candidates: [] });
						const result = await modelApi.fetchEnrich(query);
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
						const msg = err instanceof Error ? err.message : "Catalog/enrich failed";
						callbacks.onSetFillStatus(msg, { error: true, candidates: [] });
					}
				})();
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
			resultsDiv.innerHTML = '<div class="status-loading">Searching…</div>';
			try {
				const entries = await modelApi.fetchCatalog(query, 50);
				let html = "";
				for (const entry of entries) {
					const name = String(entry.model?.name ?? entry.modelId);
					html += `<div class="catalog-entry" data-catalog="${escAttr(JSON.stringify(entry))}">`;
					html += `<span class="catalog-id"><code>${esc(entry.modelId)}</code></span>`;
					html += `<span class="catalog-name">${esc(name)}</span>`;
					html += `<span class="catalog-provider">${esc(entry.provider)}</span>`;
					html += '<button class="btn-save btn-sm">Select</button>';
					html += "</div>";
				}
				if (entries.length === 0) html = '<div class="catalog-empty">No results</div>';
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
				resultsDiv.innerHTML = '<div class="error-msg">Catalog unavailable</div>';
			}
		});
	}

	// Discover button
	listen("btn-discover", "click", async () => {
		if (!state.selectedProvider || !modelApi) return;
		const discoverBtn = $id("btn-discover");
		if (discoverBtn) discoverBtn.textContent = "Discovering…";

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
				const errDiv = document.createElement("div");
				errDiv.className = "error-msg";
				errDiv.textContent = msg;
				importArea.appendChild(errDiv);
			}
		} finally {
			if (discoverBtn) discoverBtn.textContent = "Import /models";
		}
	});

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

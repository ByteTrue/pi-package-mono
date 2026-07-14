/**
 * pi-vendor web manager — main application entry.
 *
 * Orchestrates state, API, views (provider/raw/preview/model), and dialog flows.
 */

import {
	type ProviderManagerState,
	type ProviderAction,
	type ApiState,
	type FieldDescriptor,
	type UiIssue,
	reduceProviderAction,
	createApiClient,
	mapConfigIssues,
	formatSecretRemovalMessage,
	validateSecretRefLocations,
	type ApiClient,
} from "./state.js";

import {
	type ProviderViewCallbacks,
	renderApp,
	showConfirmDialog,
	showPromptDialog,
} from "./provider-view.js";

import { renderRawView, bindRawView } from "./raw-view.js";
import { renderPreview } from "./preview.js";

import {
	type ModelManagerState,
	type ModelRowHandle,
	type ProviderModelConfig,
	type ImportRow,
	type OfficialModelChoice,
	reduceModelAction,
	createModelApiClient,
	getModels,
	countSecretsUnderPrefixes,
	modelSubtreePrefix,
	enrichSelectedRows,
	type ApiClient as ModelApiClient,
} from "./models/state.js";

import {
	type ModelViewCallbacks,
	renderModelSection,
	renderModelEditor,
	renderCatalogSearch,
	renderImportTray,
	bindModelEvents,
} from "./models/model-view.js";

// ── App shell ──────────────────────────────────────────────────────

type FullState = ProviderManagerState & Partial<ModelManagerState>;

let appState: FullState = {
	baseline: {},
	draft: {},
	revision: "missing",
	secretSlots: [],
	selectedProvider: null,
	rawText: null,
	dirty: false,
	errors: [],
	modelQuery: "",
	visualSort: "document",
	editor: null,
	importRows: [],
	catalogAvailable: false,
};

let api: ApiClient;
let modelApi: ModelApiClient | undefined;
let fieldDescs: FieldDescriptor[] = [];
let currentView: "provider" | "raw" | "preview" = "provider";

type AppStatus =
	| "loading" | "ready" | "saving" | "saved" | "cancelled" | "error" | "conflict";

let appStatus: AppStatus = "loading";
let appError = "";

const root = document.getElementById("app")!;

// ── Dispatch ───────────────────────────────────────────────────────

function dispatchProvider(action: ProviderAction, opts?: { silent?: boolean }): boolean {
	const result = reduceProviderAction(appState as ProviderManagerState, action);
	if (result.ok) {
		appState = { ...appState, ...result.value };
		if (result.warnings?.length) {
			appState = { ...appState, errors: [...appState.errors, ...result.warnings] };
		}
		if (!opts?.silent) render();
		return true;
	}
	appState = { ...appState, errors: [...appState.errors, result.error] };
	if (!opts?.silent) render();
	return false;
}

function dispatchModel(action: Parameters<typeof reduceModelAction>[1], opts?: { silent?: boolean }): boolean {
	const result = reduceModelAction(appState as ModelManagerState, action);
	if (result.ok) {
		appState = { ...appState, ...result.value };
		if (result.warnings?.length) {
			appState = { ...appState, errors: [...appState.errors, ...result.warnings] };
		}
		if (!opts?.silent) render();
		return true;
	}
	appState = { ...appState, errors: [...appState.errors, result.error] };
	if (!opts?.silent) render();
	return false;
}

let enrichAbort: AbortController | null = null;

function abortEnrich(): void {
	enrichAbort?.abort();
	enrichAbort = null;
}

async function enrichImportIfNeeded(): Promise<void> {
	if (!modelApi) return;
	const rows = (appState.importRows ?? []) as ImportRow[];
	const needs = rows.some((r) => r.selected && r.state === "selected-unenriched");
	if (!needs) return;
	abortEnrich();
	const ac = new AbortController();
	enrichAbort = ac;
	try {
		const updated = await enrichSelectedRows(rows, modelApi, ac.signal, (row) => {
			if (enrichAbort !== ac) return;
			dispatchModel({ type: "import-update-row", id: row.id, update: row }, { silent: true });
		});
		// Ignore stale controllers after clear/cancel so tray cannot resurrect.
		if (enrichAbort !== ac) return;
		dispatchModel({ type: "import-set-rows", rows: updated });
	} catch {
		/* network errors surface as failed rows */
	}
}

// ── Render ─────────────────────────────────────────────────────────

function render(): void {
	if (appStatus === "loading") {
		root.innerHTML = '<div class="status status-loading">Loading configuration…</div>';
		return;
	}
	if (appStatus === "error") {
		root.innerHTML = `<div class="status status-error">${esc(appError)}</div>
			<div class="actions"><button class="btn-cancel" id="btn-cancel">Cancel</button></div>`;
		bindCancel();
		return;
	}
	if (appStatus === "saved") {
		root.innerHTML = '<div class="status status-saved">Configuration saved. You may close this page.</div>';
		return;
	}
	if (appStatus === "cancelled") {
		root.innerHTML = '<div class="status status-loading">Session cancelled. You may close this page.</div>';
		return;
	}
	if (appStatus === "conflict") {
		root.innerHTML = `<div class="status status-error">${esc(appError)}</div>
			<div class="actions"><button class="btn-cancel" id="btn-cancel">Close</button></div>`;
		bindCancel();
		return;
	}
	if (appStatus === "saving") {
		root.innerHTML = '<div class="status status-loading">Saving…</div>';
		return;
	}

	switch (currentView) {
		case "raw": {
			root.innerHTML = renderRawView(appState as ProviderManagerState);
			bindRawView({
				onSetText: (text) => {
					// Buffer only — do not full-render (would reset caret).
					const result = reduceProviderAction(appState as ProviderManagerState, { type: "set-raw-text", text });
					if (result.ok) appState = { ...appState, ...result.value };
				},
				onApply: async (text) => {
					// Preflight secret removal confirmation before mutation.
					let parsed: unknown;
					try {
						parsed = JSON.parse(text);
					} catch {
						dispatchProvider({ type: "set-raw-text", text });
						dispatchProvider({ type: "apply-raw", text });
						return;
					}
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						const check = validateSecretRefLocations(parsed as typeof appState.draft, appState.secretSlots);
						if (check.ok && check.value.removed.length > 0) {
							const confirmed = await showConfirmDialog(
								"Remove secrets",
								formatSecretRemovalMessage(check.value.removed),
								"Remove secrets",
							);
							if (!confirmed) {
								dispatchProvider({ type: "set-raw-text", text });
								return;
							}
							dispatchProvider({ type: "set-raw-text", text });
							if (dispatchProvider({ type: "apply-raw", text, confirmSecretRemoval: true })) {
								currentView = "provider";
								render();
							}
							return;
						}
					}
					dispatchProvider({ type: "set-raw-text", text });
					if (dispatchProvider({ type: "apply-raw", text, confirmSecretRemoval: true })) {
						currentView = "provider";
						render();
					}
				},
				onDiscard: () => {
					// Drop buffer, return to structured.
					const result = reduceProviderAction(appState as ProviderManagerState, { type: "set-raw-text", text: "" });
					if (result.ok) appState = { ...appState, ...result.value, rawText: null };
					currentView = "provider";
					render();
				},
				onStay: () => {
					// Keep invalid/unapplied buffer and stay on raw view.
					const ta = document.getElementById("raw-textarea") as HTMLTextAreaElement | null;
					if (ta) {
						const result = reduceProviderAction(appState as ProviderManagerState, { type: "set-raw-text", text: ta.value });
						if (result.ok) appState = { ...appState, ...result.value };
					}
				},
			});
			break;
		}
		case "preview": {
			root.innerHTML = renderPreview(appState as ProviderManagerState);
			const previewDiv = root.querySelector(".preview");
			if (previewDiv) {
				const backBtn = document.createElement("button");
				backBtn.className = "btn-cancel";
				backBtn.textContent = "Back";
				backBtn.addEventListener("click", () => { currentView = "provider"; render(); });
				previewDiv.insertBefore(backBtn, previewDiv.firstChild);
			}
			break;
		}
		case "provider":
		default: {
			const providerCallbacks: ProviderViewCallbacks = {
				onSelect: (key) => dispatchProvider({ type: "select", key }),
				onCreate: (key) => dispatchProvider({ type: "create", key }),
				onRename: async (from, to) => {
					const first = reduceProviderAction(appState as ProviderManagerState, {
						type: "rename",
						from,
						to,
						conflict: "reject",
					});
					if (first.ok) {
						appState = { ...appState, ...first.value };
						render();
						return;
					}
					// Conflict / secret block messages.
					if (/confirm overwrite/i.test(first.error.message)) {
						const confirmed = await showConfirmDialog(
							"Overwrite provider",
							first.error.message,
							"Overwrite",
						);
						if (!confirmed) {
							appState = { ...appState, errors: [...appState.errors, first.error] };
							render();
							return;
						}
						dispatchProvider({ type: "rename", from, to, conflict: "overwrite-confirmed" });
						return;
					}
					appState = { ...appState, errors: [...appState.errors, first.error] };
					render();
				},
				onDelete: (key) => dispatchProvider({ type: "delete", key }),
				onSetField: (key, field, value) => dispatchProvider({ type: "set-field", key, field, value }, { silent: true }),
				onRemoveField: (key, field) => dispatchProvider({ type: "remove-field", key, field }),
				onAddSetting: (key, field) => {
					// Typed empty defaults by field kind when possible.
					const desc = fieldDescs.find((d) => d.key === field);
					let value: unknown = "";
					if (desc?.kind === "boolean") value = false;
					else if (desc?.kind === "json") value = {};
					dispatchProvider({ type: "set-field", key, field, value });
				},
				onReplaceSecret: (key, field, value) => {
					// Replace SecretRef with new literal; drop exact-path slot so badge clears.
					dispatchProvider({ type: "set-field", key, field, value }, { silent: true });
					const exactPath = `/providers/${key.replaceAll("~", "~0").replaceAll("/", "~1")}/${field}`;
					appState = {
						...appState,
						secretSlots: appState.secretSlots.filter((s) => s.path !== exactPath),
					};
					render();
				},
				onRemoveSecret: (key, field) => {
					dispatchProvider({ type: "remove-field", key, field }, { silent: true });
					const exactPath = `/providers/${key.replaceAll("~", "~0").replaceAll("/", "~1")}/${field}`;
					appState = {
						...appState,
						secretSlots: appState.secretSlots.filter((s) => s.path !== exactPath),
					};
					render();
				},
				onToggleRaw: async () => {
					// Gate if rawText dirty relative to draft.
					if (appState.rawText !== null && appState.rawText !== JSON.stringify(appState.draft, null, 2)) {
						// Already in raw with buffer — just show.
						currentView = "raw";
						render();
						return;
					}
					// Enter raw: seed buffer from draft.
					dispatchProvider({ type: "set-raw-text", text: JSON.stringify(appState.draft, null, 2) });
					currentView = "raw";
					render();
				},
				onPreview: () => {
					currentView = "preview";
					render();
				},
				onSave: handleSave,
				onCancel: handleCancel,
				onDiscardDirty: () => {},
			};
			renderApp(appState as ProviderManagerState, fieldDescs, providerCallbacks);

			// Inject model section after provider detail (Feature 3 — keep)
			const detail = root.querySelector(".detail");
			if (detail) {
				const modelHtml = renderModelSection(appState as ModelManagerState, fieldDescs, {} as ModelViewCallbacks);
				detail.insertAdjacentHTML("beforeend", modelHtml);
			}

			const modelSection = root.querySelector(".model-section");
			if (modelSection) {
				const catalogHtml = renderCatalogSearch(appState as ModelManagerState);
				modelSection.insertAdjacentHTML("beforeend", catalogHtml);
			}

			const modelSection2 = root.querySelector(".model-section");
			if (modelSection2) {
				const importHtml = renderImportTray(appState as ModelManagerState);
				modelSection2.insertAdjacentHTML("beforeend", importHtml);
			}

			const editorHtml = renderModelEditor(appState as ModelManagerState, fieldDescs, {} as ModelViewCallbacks);
			if (editorHtml) {
				document.body.insertAdjacentHTML("beforeend", editorHtml);
			}

			const modelCallbacks: ModelViewCallbacks = {
				onOpenEditor: (handle, value) =>
					dispatchModel({ type: "model-open-editor", handle, value }),
				onUpdateEditor: (field, value) =>
					dispatchModel({ type: "model-update-editor", field, value }),
				onApplyTemplate: (official, status) =>
					dispatchModel({ type: "model-apply-template", official, status }),
				onSetFillStatus: (status, opts) =>
					dispatchModel({
						type: "model-set-fill-status",
						status,
						error: opts?.error,
						candidates: opts?.candidates,
					}),
				onCloseEditor: () => dispatchModel({ type: "model-close-editor" }),
				onAdd: (pk) => {
					if (!appState.editor) return;
					const model = appState.editor.value as ProviderModelConfig;
					const added = dispatchModel({ type: "model-add", providerKey: pk, model });
					if (added) return;
					// Conflict → confirm overwrite
					const err = appState.errors.at(-1)?.message ?? "";
					if (!/exists|overwrite/i.test(err)) return;
					void (async () => {
						const models = getModels(appState.draft, pk);
						const id = String(model.id ?? "").trim();
						const idx = models.findIndex((m) => m.id === id);
						const secrets =
							idx >= 0
								? countSecretsUnderPrefixes(appState.secretSlots, [
										modelSubtreePrefix(pk, idx),
								  ])
								: 0;
						const msg =
							secrets > 0
								? `Model "${id}" exists and has ${secrets} known secret(s). Overwrite?`
								: `Model "${id}" already exists. Overwrite?`;
						const ok = await showConfirmDialog("Overwrite model", msg, "Overwrite");
						if (!ok || !appState.editor) return;
						dispatchModel({
							type: "model-replace",
							providerKey: pk,
							previousId: id,
							model: appState.editor.value as ProviderModelConfig,
							conflict: "overwrite-confirmed",
						});
					})();
				},
				onReplace: (pk, prevId, conflict) => {
					if (!appState.editor) return;
					const model = appState.editor.value as ProviderModelConfig;
					const ok = dispatchModel({
						type: "model-replace",
						providerKey: pk,
						previousId: prevId,
						model,
						conflict,
					});
					if (ok || conflict === "overwrite-confirmed") return;
					const err = appState.errors.at(-1)?.message ?? "";
					if (!/exists|overwrite/i.test(err)) return;
					void (async () => {
						const models = getModels(appState.draft, pk);
						const id = String(model.id ?? "").trim();
						const idx = models.findIndex((m) => m.id === id);
						const secrets =
							idx >= 0
								? countSecretsUnderPrefixes(appState.secretSlots, [
										modelSubtreePrefix(pk, idx),
								  ])
								: 0;
						const msg =
							secrets > 0
								? `Target model has ${secrets} known secret(s). Overwrite?`
								: `Model id "${id}" already exists. Overwrite?`;
						const confirmed = await showConfirmDialog("Overwrite model", msg, "Overwrite");
						if (!confirmed || !appState.editor) return;
						dispatchModel({
							type: "model-replace",
							providerKey: pk,
							previousId: prevId,
							model: appState.editor.value as ProviderModelConfig,
							conflict: "overwrite-confirmed",
						});
					})();
				},
				onDelete: (pk, modelId) => {
					const models = getModels(appState.draft, pk);
					const idx = models.findIndex((m) => m.id === modelId);
					const secrets =
						idx >= 0
							? countSecretsUnderPrefixes(appState.secretSlots, [
									modelSubtreePrefix(pk, idx),
							  ])
							: 0;
					void (async () => {
						const msg =
							secrets > 0
								? `Delete model "${modelId}"? Removes ${secrets} known secret(s).`
								: `Delete model "${modelId}"?`;
						const confirmed = await showConfirmDialog("Delete model", msg, "Delete");
						if (!confirmed) return;
						dispatchModel({ type: "model-delete", providerKey: pk, modelId });
					})();
				},
				onSearch: (q) => dispatchModel({ type: "model-search", query: q }),
				onSort: (s) => dispatchModel({ type: "model-sort", sort: s }),
				onDiscover: () => {},
				onImportApply: (pk, conflict) =>
					dispatchModel({ type: "import-apply", providerKey: pk, conflict }),
				onImportSetRows: (rows) => {
					dispatchModel({ type: "import-set-rows", rows });
					// Kick enrichment for selected rows after selection changes; initial rows start unselected.
				},
				onImportToggle: (id) => {
					if (!dispatchModel({ type: "import-toggle", id })) return;
					void enrichImportIfNeeded();
				},
				onImportClear: () => {
					abortEnrich();
					dispatchModel({ type: "import-set-rows", rows: [] });
				},
				onImportChooseCandidate: (id, choice) =>
					dispatchModel({ type: "import-choose-candidate", id, choice }),
				onImportConfirmDefault: (id) =>
					dispatchModel({ type: "import-confirm-default", id }),
			};

			bindModelEvents(appState as ModelManagerState, modelCallbacks, modelApi);

			// Focus first field-level error when present.
			const firstFieldErr = appState.errors.find((e) => e.field && e.field !== "raw");
			if (firstFieldErr?.field) {
				const el = document.getElementById(`field-${firstFieldErr.field}`) as HTMLElement | null;
				el?.focus?.();
			}

			break;
		}
	}
}

// ── Helpers ────────────────────────────────────────────────────────

function esc(text: string): string {
	const el = document.createElement("span");
	el.textContent = text;
	return el.innerHTML;
}

function bindCancel(): void {
	document.getElementById("btn-cancel")?.addEventListener("click", handleCancel);
}

// ── Actions ────────────────────────────────────────────────────────

async function handleSave(): Promise<void> {
	// Local SecretRef preflight before PUT
	const pre = validateSecretRefLocations(appState.draft, appState.secretSlots);
	if (!pre.ok) {
		appState = { ...appState, errors: [pre.error] };
		render();
		return;
	}
	if (pre.value.removed.length > 0) {
		const confirmed = await showConfirmDialog(
			"Remove secrets",
			formatSecretRemovalMessage(pre.value.removed),
			"Save without secrets",
		);
		if (!confirmed) return;
	}

	appStatus = "saving";
	render();
	try {
		await api.saveConfig(appState.draft, appState.revision);
		appStatus = "saved";
		try { sessionStorage.removeItem("pi-vendor-token"); } catch { /* ignore */ }
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code === "config_changed") {
			appStatus = "conflict";
			appError = (err as Error).message;
		} else if (code === "invalid_config") {
			appStatus = "ready";
			const issues = (err as { issues?: Array<{ path?: string; message: string }> }).issues ?? [];
			const mapped: UiIssue[] = mapConfigIssues(issues, (err as Error).message);
			appState = { ...appState, errors: mapped };
		} else {
			appStatus = "ready";
			const msg = (err as Error).message;
			appState = { ...appState, errors: [{ message: msg }] };
		}
	}
	render();
}

async function handleCancel(): Promise<void> {
	if (appState.dirty) {
		const confirmed = await showConfirmDialog("Discard Changes", "You have unsaved changes. Discard them?", "Discard");
		if (!confirmed) return;
	}
	abortEnrich();
	await api.cancelSession();
	appStatus = "cancelled";
	render();
}

// ── Init ───────────────────────────────────────────────────────────

async function init(): Promise<void> {
	let token = sessionStorage.getItem("pi-vendor-token");
	if (!token && window.location.hash.startsWith("#token=")) {
		token = window.location.hash.slice(7);
		sessionStorage.setItem("pi-vendor-token", token);
		history.replaceState(null, "", window.location.pathname);
	}
	if (!token) {
		appStatus = "error";
		appError = "Missing session token. Please reopen from Pi.";
		render();
		return;
	}

	api = createApiClient(token);
	modelApi = createModelApiClient(token);

	try {
		const apiState = await api.fetchState();
		fieldDescs = apiState.providerFields;
		appState.catalogAvailable = (apiState as Record<string, unknown>).catalogAvailable === true;
		dispatchProvider({ type: "load", apiState });
		appStatus = "ready";
	} catch (err) {
		appStatus = "error";
		appError = err instanceof Error ? err.message : "Failed to load configuration";
	}
	render();
}

init();

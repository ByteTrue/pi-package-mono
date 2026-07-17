/**
 * Model manager client state — model table, editor, catalog, import flows.
 *
 * Extends ProviderManagerState with model-specific fields.
 * All functions are environment-free for esbuild bundling.
 */

import {
	addModel,
	replaceModel,
	deleteModel,
	type ConflictPolicy,
	type MutationResult,
} from "../../../config-mutations.js";
import type { ProviderModelConfig as CoreModelConfig } from "../../../models-json.js";
import {
	toWebModelConfig,
	type OfficialModelChoice,
	type WebModelConfig,
	type WebModelEnrichmentResult,
} from "../../../model-source/web-model-dto.js";
import type {
	ProviderManagerState,
	SecretSlot,
	UiIssue,
	UiResult,
	WebModelsDraft,
} from "../state.js";

// ── Types ──────────────────────────────────────────────────────────

export type ModelRowHandle = { providerKey: string; index: number; previousId: string };

export type ProviderModelConfig = CoreModelConfig & Record<string, unknown>;

export type { OfficialModelChoice, WebModelConfig, WebModelEnrichmentResult };

export type OfficialFillCandidate = {
	provider: string;
	modelId: string;
	model: Record<string, unknown>;
};

export type ModelEditorState = {
	handle: ModelRowHandle | null;
	value: ProviderModelConfig;
	issues: UiIssue[];
	/** Ephemeral UI feedback for official fill (survives re-render). */
	fillStatus?: string;
	fillError?: boolean;
	fillCandidates?: OfficialFillCandidate[];
};

export type ImportRow = {
	id: string;
	selected: boolean;
	state: "selected-unenriched" | "ready" | "ambiguous" | "default-warning" | "failed";
	choice?: OfficialModelChoice;
	candidates?: OfficialModelChoice[];
	model?: WebModelConfig;
	error?: string;
};

export type VisualSort = "document" | "id" | "name";

export type ModelManagerState = ProviderManagerState & {
	modelQuery: string;
	visualSort: VisualSort;
	editor: ModelEditorState | null;
	importRows: ImportRow[];
	catalogAvailable: boolean;
};

export type ModelRowView = ModelRowHandle & { model: ProviderModelConfig };

// ── Helpers ────────────────────────────────────────────────────────

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function issue(message: string, opts?: { path?: string; field?: string }): UiIssue {
	return { message, ...opts };
}

function ok<T>(value: T, warnings?: UiIssue[]): UiResult<T> {
	return { ok: true, value, warnings };
}

function fail(message: string, opts?: { path?: string; field?: string }): UiResult<never> {
	return { ok: false, error: issue(message, opts) };
}

function pointer(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function getProviders(draft: WebModelsDraft): Record<string, Record<string, unknown>> {
	return ((draft as Record<string, unknown>).providers ?? {}) as Record<string, Record<string, unknown>>;
}

export function getModels(draft: WebModelsDraft, providerKey: string): ProviderModelConfig[] {
	const config = getProviders(draft)[providerKey];
	return (Array.isArray(config?.models) ? config.models : []) as ProviderModelConfig[];
}

/** Segment-safe path prefix match (never matches /models/10 for /models/1). */
export function pathUnderPrefix(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

export function modelSubtreePrefix(providerKey: string, index: number): string {
	return `/providers/${pointer(providerKey)}/models/${index}`;
}

export function compareCodeUnit(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

/** Project any object through closed allowlist DTO (no routing/credential/unknown fields). */
export function closedModelFromUnknown(raw: Record<string, unknown>): ProviderModelConfig | undefined {
	const closed = toWebModelConfig(raw);
	if (!closed) return undefined;
	return clone(closed) as ProviderModelConfig;
}

/** Official template fields written by fill; never includes headers/secrets. */
export const OFFICIAL_TEMPLATE_KEYS = [
	"id",
	"name",
	"api",
	"reasoning",
	"thinkingLevelMap",
	"input",
	"cost",
	"contextWindow",
	"maxTokens",
	"compat",
] as const;

/**
 * Merge closed official model into editor value.
 * Replaces whitelist template fields; always preserves current headers.
 */
export function applyOfficialTemplate(
	current: ProviderModelConfig,
	official: WebModelConfig | ProviderModelConfig | Record<string, unknown>,
): ProviderModelConfig {
	const projected =
		closedModelFromUnknown(official as Record<string, unknown>) ??
		({ id: String((official as { id?: unknown }).id ?? "") } as ProviderModelConfig);
	const next: Record<string, unknown> = { ...current };
	const headers = current.headers;
	for (const key of OFFICIAL_TEMPLATE_KEYS) {
		const value = (projected as Record<string, unknown>)[key];
		if (value === undefined) delete next[key];
		else next[key] = clone(value);
	}
	if (headers !== undefined) next.headers = headers;
	else delete next.headers;
	return next as ProviderModelConfig;
}

export function parseEditorJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	return JSON.parse(trimmed) as unknown;
}

export function buildEditorInputModes(text: boolean, image: boolean): Array<"text" | "image"> | undefined {
	const modes: Array<"text" | "image"> = [];
	if (text) modes.push("text");
	if (image) modes.push("image");
	return modes.length > 0 ? modes : undefined;
}

export function buildEditorCost(
	values: Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite", string>>,
	tiersText = "",
): Record<string, unknown> | undefined {
	const cost: Record<string, unknown> = {};
	for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
		const raw = values[key]?.trim() ?? "";
		if (!raw) continue;
		const value = Number(raw);
		if (!Number.isFinite(value)) throw new Error(`${key} cost must be a number`);
		cost[key] = value;
	}
	const tiers = parseEditorJson(tiersText);
	if (tiers !== undefined) {
		if (!Array.isArray(tiers)) throw new Error("Cost tiers must be a JSON array");
		cost.tiers = tiers;
	}
	return Object.keys(cost).length > 0 ? cost : undefined;
}

// ── Model Actions ──────────────────────────────────────────────────

export type ModelAction =
	| { type: "model-search"; query: string }
	| { type: "model-sort"; sort: VisualSort }
	| { type: "model-open-editor"; handle: ModelRowHandle | null; value?: ProviderModelConfig }
	| { type: "model-update-editor"; field: string; value: unknown }
	| {
			type: "model-apply-template";
			official: WebModelConfig | ProviderModelConfig | Record<string, unknown>;
			status?: string;
	  }
	| {
			type: "model-set-fill-status";
			status: string;
			error?: boolean;
			candidates?: OfficialFillCandidate[];
	  }
	| { type: "model-close-editor" }
	| { type: "model-add"; providerKey: string; model: ProviderModelConfig }
	| {
			type: "model-replace";
			providerKey: string;
			previousId: string;
			model: ProviderModelConfig;
			conflict: ConflictPolicy;
	  }
	| { type: "model-delete"; providerKey: string; modelId: string }
	| { type: "import-set-rows"; rows: ImportRow[] }
	| { type: "import-toggle"; id: string }
	| { type: "import-select-ids"; ids: string[]; selected: boolean }
	| { type: "import-update-row"; id: string; update: Partial<ImportRow> }
	| { type: "import-choose-candidate"; id: string; choice: OfficialModelChoice }
	| { type: "import-confirm-default"; id: string }
	| { type: "import-apply"; providerKey: string; conflict: "skip-existing" | "replace-selected" };

// ── Model Table Helpers ────────────────────────────────────────────

export function filterModels(models: ProviderModelConfig[], query: string): ProviderModelConfig[] {
	if (!query) return models;
	const q = query.toLowerCase();
	return models.filter((m) => {
		const id = String(m.id ?? "").toLowerCase();
		const name = String(m.name ?? "").toLowerCase();
		return id.includes(q) || name.includes(q);
	});
}

export function sortModels(models: ProviderModelConfig[], sort: VisualSort): ProviderModelConfig[] {
	const sorted = [...models];
	switch (sort) {
		case "id":
			sorted.sort((a, b) => compareCodeUnit(String(a.id ?? ""), String(b.id ?? "")));
			break;
		case "name":
			sorted.sort((a, b) => compareCodeUnit(String(a.name ?? ""), String(b.name ?? "")));
			break;
		case "document":
		default:
			break;
	}
	return sorted;
}

export function findModelIndex(models: ProviderModelConfig[], id: string): number {
	return models.findIndex((m) => m.id === id);
}

/** Render-only rows: visual filter/sort never mutates document order. */
export function listModelRows(
	draft: WebModelsDraft,
	providerKey: string,
	query: string,
	sort: VisualSort,
): ModelRowView[] {
	const models = getModels(draft, providerKey);
	const indexed = models.map((model, index) => ({
		providerKey,
		index,
		previousId: String(model.id ?? ""),
		model,
	}));
	const filtered = query
		? indexed.filter((row) => {
				const id = row.previousId.toLowerCase();
				const name = String(row.model.name ?? "").toLowerCase();
				const q = query.toLowerCase();
				return id.includes(q) || name.includes(q);
			})
		: indexed;
	if (sort === "document") return filtered;
	return [...filtered].sort((a, b) => {
		if (sort === "id") return compareCodeUnit(a.previousId, b.previousId);
		return compareCodeUnit(String(a.model.name ?? ""), String(b.model.name ?? ""));
	});
}

// ── Secret Ref Shift Simulation ────────────────────────────────────

const SECRET_PREFIX = "pi-vendor-secret:";

function isSecretRef(value: unknown): value is string {
	return typeof value === "string" && value.startsWith(SECRET_PREFIX);
}

function collectSecretPaths(draft: WebModelsDraft): Map<string, string[]> {
	const paths = new Map<string, string[]>();

	function walk(value: unknown, path: string): void {
		if (isSecretRef(value)) {
			const existing = paths.get(value);
			if (existing) existing.push(path);
			else paths.set(value, [path]);
			return;
		}
		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) walk(value[i], `${path}/${i}`);
		} else if (value && typeof value === "object") {
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				walk(v, `${path}/${k.replaceAll("~", "~0").replaceAll("/", "~1")}`);
			}
		}
	}

	walk(draft, "");
	return paths;
}

export function countSecretsUnderPrefixes(slots: SecretSlot[], prefixes: string[]): number {
	return slots.filter((s) => prefixes.some((p) => pathUnderPrefix(s.path, p))).length;
}

export function previewModelMutation(
	before: WebModelsDraft,
	mutation: () => MutationResult<WebModelsDraft>,
	slots: SecretSlot[],
	options: { allowedRemovedPrefixes: string[] },
): UiResult<{ draft: WebModelsDraft; removedSecrets: SecretSlot[] }> {
	const result = mutation();
	if (!result.ok) {
		return fail(result.error.message);
	}

	const after = result.value;
	const beforePaths = collectSecretPaths(before);
	const afterPaths = collectSecretPaths(after);
	const slotMap = new Map(slots.map((s) => [s.ref, s]));

	const removedSecrets: SecretSlot[] = [];

	for (const [ref, paths] of beforePaths) {
		const slot = slotMap.get(ref);
		if (!slot) continue;

		const afterPathList = afterPaths.get(ref);
		if (!afterPathList || afterPathList.length === 0) {
			const isAllowed = options.allowedRemovedPrefixes.some((prefix) => pathUnderPrefix(slot.path, prefix));
			if (!isAllowed) {
				return fail(`Secret reference was removed unexpectedly at ${slot.path}`);
			}
			removedSecrets.push(slot);
			continue;
		}

		if (afterPathList.length > 1) {
			return fail(`Secret reference appears in multiple locations: ${ref}`);
		}

		const newPath = afterPathList[0]!;
		if (newPath !== slot.path) {
			// Index shift / rename / reorder of surviving refs is always blocked (no remap).
			return fail(`Secret reference moved from ${slot.path} to ${newPath}`);
		}
	}

	return ok({ draft: after, removedSecrets });
}

function dropRemovedSlots(slots: SecretSlot[], removed: SecretSlot[]): SecretSlot[] {
	if (removed.length === 0) return slots;
	const refs = new Set(removed.map((s) => s.ref));
	return slots.filter((s) => !refs.has(s.ref));
}

// ── Model Reducer ──────────────────────────────────────────────────

export function reduceModelAction(
	state: ModelManagerState,
	action: ModelAction,
): UiResult<ModelManagerState> {
	const next = { ...state, errors: [] as UiIssue[] };

	switch (action.type) {
		case "model-search":
			return ok({ ...next, modelQuery: action.query });

		case "model-sort":
			return ok({ ...next, visualSort: action.sort });

		case "model-open-editor": {
			if (!action.handle) {
				return ok({
					...next,
					editor: {
						handle: null,
						value: (action.value ? clone(action.value) : { id: "" }) as ProviderModelConfig,
						issues: [],
					},
				});
			}
			const models = getModels(next.draft, action.handle.providerKey);
			const model = models[action.handle.index];
			if (!model || String(model.id ?? "") !== action.handle.previousId) {
				return fail("Model has changed. Please reopen the editor.");
			}
			return ok({
				...next,
				editor: {
					handle: action.handle,
					value: clone(model),
					issues: [],
				},
			});
		}

		case "model-update-editor": {
			if (!next.editor) return fail("No editor open");
			const value = { ...next.editor.value } as ProviderModelConfig;
			if (action.value === undefined || action.value === null || action.value === "") {
				delete (value as Record<string, unknown>)[action.field];
			} else {
				(value as Record<string, unknown>)[action.field] = action.value;
			}
			return ok({ ...next, editor: { ...next.editor, value } });
		}

		case "model-apply-template": {
			if (!next.editor) return fail("No editor open");
			const value = applyOfficialTemplate(next.editor.value, action.official);
			return ok({
				...next,
				editor: {
					...next.editor,
					value,
					issues: [],
					fillStatus: action.status ?? "Filled template fields from official source.",
					fillError: false,
					// Keep candidates so users can switch official sources without re-searching.
					fillCandidates: next.editor.fillCandidates,
				},
			});
		}

		case "model-set-fill-status": {
			if (!next.editor) return fail("No editor open");
			return ok({
				...next,
				editor: {
					...next.editor,
					fillStatus: action.status,
					fillError: Boolean(action.error),
					fillCandidates: action.candidates ?? next.editor.fillCandidates,
				},
			});
		}

		case "model-close-editor":
			return ok({ ...next, editor: null });

		case "model-add": {
			const id = String(action.model.id ?? "").trim();
			if (!id) return fail("Model ID is required");
			const model = { ...clone(action.model), id } as CoreModelConfig;
			const result = previewModelMutation(
				next.draft,
				() => addModel(next.draft, action.providerKey, model),
				next.secretSlots,
				{ allowedRemovedPrefixes: [] },
			);
			if (!result.ok) return result;
			return ok({
				...next,
				draft: result.value.draft,
				secretSlots: dropRemovedSlots(next.secretSlots, result.value.removedSecrets),
				editor: null,
				dirty: true,
			});
		}

		case "model-replace": {
			const previousId = action.previousId.trim();
			const newId = String(action.model.id ?? "").trim();
			if (!previousId || !newId) return fail("Model ID is required");
			const model = { ...clone(action.model), id: newId } as CoreModelConfig;

			const models = getModels(next.draft, action.providerKey);
			const allowedPrefixes: string[] = [];
			if (action.conflict === "overwrite-confirmed") {
				const targetIdx = models.findIndex((m) => m.id === newId);
				const sourceIdx = models.findIndex((m) => m.id === previousId);
				if (targetIdx >= 0 && targetIdx !== sourceIdx) {
					allowedPrefixes.push(modelSubtreePrefix(action.providerKey, targetIdx));
				}
			}

			const result = previewModelMutation(
				next.draft,
				() =>
					replaceModel(next.draft, action.providerKey, previousId, model, {
						conflict: action.conflict,
					}),
				next.secretSlots,
				{ allowedRemovedPrefixes: allowedPrefixes },
			);
			if (!result.ok) return result;
			return ok({
				...next,
				draft: result.value.draft,
				secretSlots: dropRemovedSlots(next.secretSlots, result.value.removedSecrets),
				editor: null,
				dirty: true,
			});
		}

		case "model-delete": {
			const id = action.modelId.trim();
			if (!id) return fail("Model ID is required");
			const models = getModels(next.draft, action.providerKey);
			const idx = models.findIndex((m) => m.id === id);
			if (idx < 0) return fail("Model not found");

			const allowedPrefixes = [modelSubtreePrefix(action.providerKey, idx)];
			const result = previewModelMutation(
				next.draft,
				() => deleteModel(next.draft, action.providerKey, id),
				next.secretSlots,
				{ allowedRemovedPrefixes: allowedPrefixes },
			);
			if (!result.ok) return result;
			return ok({
				...next,
				draft: result.value.draft,
				secretSlots: dropRemovedSlots(next.secretSlots, result.value.removedSecrets),
				editor: null,
				dirty: true,
			});
		}

		case "import-set-rows":
			return ok({ ...next, importRows: action.rows });

		case "import-toggle": {
			const rows = next.importRows.map((r) =>
				r.id === action.id ? { ...r, selected: !r.selected } : r,
			);
			const selected = rows.filter((r) => r.selected).length;
			if (selected > 100) return fail("Maximum 100 models per batch");
			return ok({ ...next, importRows: rows });
		}

		case "import-select-ids": {
			const idSet = new Set(action.ids);
			const rows = next.importRows.map((r) =>
				idSet.has(r.id) ? { ...r, selected: action.selected } : r,
			);
			const selected = rows.filter((r) => r.selected).length;
			if (selected > 100) return fail("Maximum 100 models per batch");
			return ok({ ...next, importRows: rows });
		}

		case "import-update-row": {
			const rows = next.importRows.map((r) =>
				r.id === action.id ? { ...r, ...action.update } : r,
			);
			return ok({ ...next, importRows: rows });
		}

		case "import-choose-candidate": {
			const closed = closedModelFromUnknown(action.choice.model as Record<string, unknown>);
			if (!closed) return fail("Selected candidate is not a closed model DTO");
			const rows = next.importRows.map((r) =>
				r.id === action.id
					? {
							...r,
							state: "ready" as const,
							choice: action.choice,
							model: closed as WebModelConfig,
							candidates: undefined,
							error: undefined,
						}
					: r,
			);
			return ok({ ...next, importRows: rows });
		}

		case "import-confirm-default": {
			const row = next.importRows.find((r) => r.id === action.id);
			if (!row || row.state !== "default-warning" || !row.model) {
				return fail("No default-warning row to confirm");
			}
			const closed = closedModelFromUnknown(row.model as Record<string, unknown>);
			if (!closed) return fail("Default model is not a closed model DTO");
			const rows = next.importRows.map((r) =>
				r.id === action.id
					? { ...r, state: "ready" as const, model: closed as WebModelConfig, error: undefined }
					: r,
			);
			return ok({ ...next, importRows: rows });
		}

		case "import-apply": {
			// Deterministic discovery order = importRows order; only ready+selected apply.
			const selected = next.importRows.filter((r) => r.selected && r.state === "ready" && r.model);
			if (selected.length === 0) return fail("No ready models selected");
			if (selected.length > 100) return fail("Maximum 100 models per batch");

			let draft = clone(next.draft);
			let secretSlots = next.secretSlots;
			const skipped: string[] = [];
			const errors: string[] = [];

			for (const row of selected) {
				const closed = closedModelFromUnknown(row.model as Record<string, unknown>);
				if (!closed) {
					errors.push(`${row.id}: not a closed model DTO`);
					continue;
				}
				const id = String(closed.id ?? "").trim();
				if (!id) {
					errors.push(`${row.id}: invalid model id`);
					continue;
				}
				const existingModels = getModels(draft, action.providerKey);
				const exists = existingModels.some((m) => m.id === id);

				if (exists && action.conflict === "skip-existing") {
					skipped.push(id);
					continue;
				}

				const allowedPrefixes: string[] = [];
				if (exists) {
					const targetIdx = findModelIndex(existingModels, id);
					if (targetIdx >= 0) allowedPrefixes.push(modelSubtreePrefix(action.providerKey, targetIdx));
				}

				const before = draft;
				const mutation = exists
					? () =>
							replaceModel(before, action.providerKey, id, closed as CoreModelConfig, {
								conflict: "overwrite-confirmed",
							})
					: () => addModel(before, action.providerKey, closed as CoreModelConfig);

				const refResult = previewModelMutation(before, mutation, secretSlots, {
					allowedRemovedPrefixes: allowedPrefixes,
				});
				if (!refResult.ok) {
					errors.push(`${id}: ${refResult.error.message}`);
					continue;
				}
				draft = refResult.value.draft;
				secretSlots = dropRemovedSlots(secretSlots, refResult.value.removedSecrets);
			}

			const warnings: UiIssue[] = [];
			if (skipped.length > 0) {
				warnings.push(issue(`${skipped.length} existing model(s) skipped`));
			}
			if (errors.length > 0) {
				warnings.push(issue(`${errors.length} model(s) failed: ${errors.join("; ")}`));
			}

			return ok(
				{
					...next,
					draft,
					secretSlots,
					importRows: [],
					dirty: true,
				},
				warnings,
			);
		}

		default:
			return fail("Unknown model action");
	}
}

// ── Catalog/Enrich API Helpers ─────────────────────────────────────

export type ApiClient = {
	fetchCatalog(query: string, limit: number, signal?: AbortSignal): Promise<OfficialModelChoice[]>;
	fetchEnrich(modelId: string, signal?: AbortSignal): Promise<WebModelEnrichmentResult>;
	fetchDiscover(
		providerKey: string,
		provider: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<{ ids: string[] }>;
};

export function createModelApiClient(token: string): ApiClient {
	const h = { Authorization: `Bearer ${token}` };

	return {
		async fetchCatalog(query: string, limit: number, signal?: AbortSignal): Promise<OfficialModelChoice[]> {
			const res = await fetch(`/api/catalog?q=${encodeURIComponent(query)}&limit=${limit}`, {
				headers: h,
				signal,
			});
			if (!res.ok) throw new Error("Official templates are unavailable");
			const data = (await res.json()) as { entries: OfficialModelChoice[] };
			return data.entries;
		},

		async fetchEnrich(modelId: string, signal?: AbortSignal): Promise<WebModelEnrichmentResult> {
			const res = await fetch("/api/enrich", {
				method: "POST",
				headers: { ...h, "Content-Type": "application/json" },
				body: JSON.stringify({ modelId }),
				signal,
			});
			if (!res.ok) throw new Error("Could not load this model template");
			return res.json() as Promise<WebModelEnrichmentResult>;
		},

		async fetchDiscover(
			providerKey: string,
			provider: Record<string, unknown>,
			signal?: AbortSignal,
		): Promise<{ ids: string[] }> {
			const res = await fetch("/api/discover", {
				method: "POST",
				headers: { ...h, "Content-Type": "application/json" },
				body: JSON.stringify({ providerKey, provider }),
				signal,
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: { message: "Could not list models from this provider" } }));
				throw new Error(
					(body as { error?: { message?: string } }).error?.message ?? "Could not list models from this provider",
				);
			}
			return res.json() as Promise<{ ids: string[] }>;
		},
	};
}

// ── Enrichment Pipeline ────────────────────────────────────────────

const ENRICH_CONCURRENCY = 8;

/**
 * Enrich import rows that still need metadata (concurrency 8).
 * Used after discover for the whole list, not only the currently selected rows.
 * Cancel stops scheduling pending work but keeps completed rows (no rollback).
 */
export async function enrichSelectedRows(
	rows: ImportRow[],
	api: ApiClient,
	signal?: AbortSignal,
	onProgress?: (updated: ImportRow) => void,
): Promise<ImportRow[]> {
	const results = rows.map((r) => ({ ...r }));
	const selectedIdx = results
		.map((r, i) => (r.state === "selected-unenriched" ? i : -1))
		.filter((i) => i >= 0);

	async function enrichOne(row: ImportRow): Promise<ImportRow> {
		if (signal?.aborted) return row; // leave as-is when cancelled before start
		try {
			const result = await api.fetchEnrich(row.id, signal);
			if (signal?.aborted && result) {
				// Keep successful completion if response already arrived.
			}
			if (result.kind === "ready") {
				const model = result.model
					? (closedModelFromUnknown(result.model as Record<string, unknown>) as WebModelConfig | undefined)
					: undefined;
				if (!model) {
					return { ...row, state: "failed", error: "Enrichment returned non-closed model" };
				}
				const state = result.warning ? ("default-warning" as const) : ("ready" as const);
				return {
					...row,
					state,
					model,
					choice: { provider: "", modelId: row.id, model },
					error: undefined,
				};
			}
			// Ambiguous: require explicit user choice — never auto-select first candidate.
			return {
				...row,
				state: "ambiguous",
				candidates: result.candidates ?? [],
				choice: undefined,
				model: undefined,
				error: undefined,
			};
		} catch (err) {
			if (signal?.aborted) return row; // preserve pre-cancel state
			return {
				...row,
				state: "failed",
			error: err instanceof Error ? err.message : "Could not load a model template",
			};
		}
	}

	let cursor = 0;
	async function worker(): Promise<void> {
		while (cursor < selectedIdx.length) {
			if (signal?.aborted) return;
			const my = cursor++;
			const idx = selectedIdx[my]!;
			const updated = await enrichOne(results[idx]!);
			results[idx] = updated;
			onProgress?.(updated);
		}
	}

	const workers = Array.from(
		{ length: Math.min(ENRICH_CONCURRENCY, selectedIdx.length) },
		() => worker(),
	);
	await Promise.all(workers);
	return results;
}

/** Build unique import rows from discovery ids (first-seen order, max 10_000 server-side). */
export function importRowsFromIds(ids: string[]): ImportRow[] {
	const seen = new Set<string>();
	const rows: ImportRow[] = [];
	for (const id of ids) {
		if (!id || seen.has(id)) continue;
		seen.add(id);
		rows.push({ id, selected: false, state: "selected-unenriched" });
	}
	return rows;
}

export function countSelectedImport(rows: ImportRow[]): number {
	return rows.filter((r) => r.selected).length;
}

/** Count ready selected import rows that would overwrite existing models, and known secrets under those targets. */
export function countImportReplaceTargets(
	draft: WebModelsDraft,
	providerKey: string,
	rows: ImportRow[],
	slots: SecretSlot[],
): { modelCount: number; secretCount: number } {
	const models = getModels(draft, providerKey);
	const prefixes: string[] = [];
	for (const row of rows) {
		if (!row.selected || row.state !== "ready" || !row.model) continue;
		const id = String(row.model.id ?? row.id).trim();
		if (!id) continue;
		const idx = findModelIndex(models, id);
		if (idx < 0) continue;
		prefixes.push(modelSubtreePrefix(providerKey, idx));
	}
	return {
		modelCount: prefixes.length,
		secretCount: countSecretsUnderPrefixes(slots, prefixes),
	};
}

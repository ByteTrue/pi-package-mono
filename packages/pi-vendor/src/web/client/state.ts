/**
 * Provider manager client state — pure reducer, secret validation, API helpers.
 *
 * Environment-free: no DOM, no fetch, no Node imports. Bundled by esbuild.
 */

import {
	createProvider,
	renameProvider,
	deleteProvider,
	isUnderProviderPath,
	categorizeSecretSlot,
	type ConflictPolicy,
	type MutationErrorCode,
	type MutationError,
	type MutationResult,
} from "../../config-mutations.js";
import type { ModelsJson } from "../../models-json.js";

// ── Types ──────────────────────────────────────────────────────────

export type ConfigRevision = "missing" | `sha256:${string}`;

export type WebModelsDraft = ModelsJson;

export type SecretSlot = { ref: string; path: string };

export type FieldDescriptor = {
	key: string;
	label: string;
	kind: "text" | "secret-text" | "boolean" | "json";
	common: boolean;
	required: boolean;
};

export type ApiState = {
	models: WebModelsDraft;
	revision: ConfigRevision;
	secretSlots: SecretSlot[];
	providerFields: FieldDescriptor[];
	modelFields: FieldDescriptor[];
};

export type { ConflictPolicy, MutationErrorCode, MutationError, MutationResult };

export type ProviderFieldKey =
	| "name" | "baseUrl" | "api" | "apiKey"
	| "headers" | "authHeader" | "compat" | "modelOverrides";

export type UiIssue = {
	path?: string;
	field?: string;
	provider?: string;
	message: string;
};

export type UiResult<T> =
	| { ok: true; value: T; warnings?: UiIssue[] }
	| { ok: false; error: UiIssue };

export type ProviderManagerState = {
	baseline: WebModelsDraft;
	draft: WebModelsDraft;
	revision: ConfigRevision;
	secretSlots: SecretSlot[];
	selectedProvider: string | null;
	rawText: string | null;
	dirty: boolean;
	errors: UiIssue[];
};

export type ProviderAction =
	| { type: "load"; apiState: ApiState }
	| { type: "create"; key: string }
	| { type: "rename"; from: string; to: string; conflict: ConflictPolicy }
	| { type: "delete"; key: string }
	| { type: "set-field"; key: string; field: ProviderFieldKey; value: unknown }
	| { type: "remove-field"; key: string; field: ProviderFieldKey }
	| { type: "apply-raw"; text: string; confirmSecretRemoval?: boolean }
	| { type: "set-raw-text"; text: string }
	| { type: "select"; key: string | null }
	| { type: "set-dirty" }
	| { type: "clear-errors" }
	| { type: "set-errors"; errors: UiIssue[] };

// ── Helpers ────────────────────────────────────────────────────────

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function issue(message: string, opts?: { path?: string; field?: string; provider?: string }): UiIssue {
	return { message, ...opts };
}

function ok<T>(value: T, warnings?: UiIssue[]): UiResult<T> {
	return { ok: true, value, warnings };
}

function fail(message: string, opts?: { path?: string; field?: string; provider?: string }): UiResult<never> {
	return { ok: false, error: issue(message, opts) };
}

function providerKey(value: string): string | undefined {
	return value.trim() || undefined;
}

function hasProvider(draft: WebModelsDraft, key: string): boolean {
	const providers = draft.providers as Record<string, unknown> | undefined;
	return providers ? Object.hasOwn(providers, key) : false;
}

function getProviders(draft: WebModelsDraft): Record<string, Record<string, unknown>> {
	return (draft.providers ?? {}) as Record<string, Record<string, unknown>>;
}

function sortedProviderKeys(draft: WebModelsDraft): string[] {
	return Object.keys(getProviders(draft)).sort();
}

function selectAfterDelete(draft: WebModelsDraft, deletedKey: string, currentSelection: string | null): string | null {
	const keys = sortedProviderKeys(draft);
	if (keys.length === 0) return null;
	if (currentSelection !== deletedKey && currentSelection && hasProvider(draft, currentSelection)) return currentSelection;
	const oldSorted = [...keys, deletedKey].sort();
	const idx = oldSorted.indexOf(deletedKey);
	const nextIdx = Math.min(idx, keys.length - 1);
	return keys[nextIdx] ?? null;
}

export function countSecretsForProvider(slots: SecretSlot[], key: string): {
	total: number;
	apiKey: number;
	header: number;
	other: number;
} {
	const matching = slots.filter((s) => isUnderProviderPath(s.path, key));
	let apiKey = 0;
	let header = 0;
	let other = 0;
	for (const s of matching) {
		const cat = categorizeSecretSlot(s.path);
		if (cat === "apiKey") apiKey += 1;
		else if (cat === "header") header += 1;
		else other += 1;
	}
	return { total: matching.length, apiKey, header, other };
}

export function formatSecretRemovalMessage(slots: SecretSlot[]): string {
	let apiKey = 0;
	let header = 0;
	let other = 0;
	for (const s of slots) {
		const cat = categorizeSecretSlot(s.path);
		if (cat === "apiKey") apiKey += 1;
		else if (cat === "header") header += 1;
		else other += 1;
	}
	const parts: string[] = [];
	if (apiKey > 0) parts.push(`${apiKey} apiKey secret(s)`);
	if (header > 0) parts.push(`${header} header secret(s)`);
	if (other > 0) parts.push(`${other} other secret(s)`);
	return parts.length > 0
		? `This will remove ${parts.join(", ")}. Continue?`
		: "Configured secrets will be removed. Continue?";
}

// ── Secret Ref Validation ──────────────────────────────────────────

const SECRET_PREFIX = "pi-vendor-secret:";

function isSecretRef(value: unknown): value is string {
	return typeof value === "string" && value.startsWith(SECRET_PREFIX);
}

function scanSecretRefs(draft: WebModelsDraft): {
	refLocations: Map<string, string[]>;
	invalid: Array<{ ref: string; path: string; reason: string }>;
} {
	const refLocations = new Map<string, string[]>();
	const invalid: Array<{ ref: string; path: string; reason: string }> = [];

	function walk(value: unknown, path: string): void {
		if (isSecretRef(value)) {
			const existing = refLocations.get(value);
			if (existing) existing.push(path);
			else refLocations.set(value, [path]);
			return;
		}
		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) {
				walk(value[i], `${path}/${i}`);
			}
		} else if (value && typeof value === "object") {
			for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
				const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
				walk(val, `${path}/${escaped}`);
			}
		}
	}

	walk(draft, "");

	for (const [ref, paths] of refLocations) {
		if (paths.length > 1) {
			invalid.push({ ref, path: paths[0]!, reason: "SecretRef appears in multiple locations" });
		}
	}

	return { refLocations, invalid };
}

export function validateSecretRefLocations(
	draft: WebModelsDraft,
	slots: SecretSlot[],
): UiResult<{ removed: SecretSlot[]; moved: SecretSlot[] }> {
	const slotMap = new Map(slots.map((s) => [s.ref, s]));
	const { refLocations, invalid } = scanSecretRefs(draft);

	if (invalid.length > 0) {
		return fail(`Invalid secret references: ${invalid.map((i) => i.reason).join("; ")}`);
	}

	const removed: SecretSlot[] = [];
	const moved: SecretSlot[] = [];

	for (const slot of slots) {
		const paths = refLocations.get(slot.ref);
		if (!paths || paths.length === 0) {
			removed.push(slot);
		} else if (paths.length > 1) {
			return fail(`Secret reference appears in multiple locations: ${slot.ref} at [${paths.join(", ")}]`);
		} else if (paths[0] === slot.path) {
			// exact
		} else {
			moved.push(slot);
			return fail(`Secret reference moved from ${slot.path} to ${paths[0]}`);
		}
	}

	for (const ref of refLocations.keys()) {
		if (!slotMap.has(ref)) {
			return fail(`Unknown secret reference: ${ref}`);
		}
	}

	return ok({ removed, moved });
}

/** Map server invalid_config issues (RFC6901) onto field/provider UiIssues when possible. */
export function mapConfigIssues(
	issues: Array<{ path?: string; message?: string; code?: string }>,
	fallbackMessage: string,
): UiIssue[] {
	if (!issues.length) return [issue(fallbackMessage)];
	return issues.map((item) => {
		const path = item.path;
		const message = item.message || fallbackMessage;
		if (!path) return issue(message);
		const m = path.match(/^\/providers\/([^/]+)(?:\/([^/]+))?/);
		if (!m) return issue(message, { path });
		const provider = m[1]!.replaceAll("~1", "/").replaceAll("~0", "~");
		const field = m[2]?.replaceAll("~1", "/").replaceAll("~0", "~");
		return issue(message, { path, provider, field });
	});
}

// ── Reducer ────────────────────────────────────────────────────────

export function reduceProviderAction(
	state: ProviderManagerState,
	action: ProviderAction,
): UiResult<ProviderManagerState> {
	const next = { ...state, errors: [] as UiIssue[] };

	switch (action.type) {
		case "load": {
			return ok({
				baseline: clone(action.apiState.models),
				draft: clone(action.apiState.models),
				revision: action.apiState.revision,
				secretSlots: clone(action.apiState.secretSlots),
				selectedProvider: sortedProviderKeys(action.apiState.models)[0] ?? null,
				rawText: null,
				dirty: false,
				errors: [],
			});
		}

		case "select": {
			if (action.key && !hasProvider(next.draft, action.key)) {
				return fail("Provider not found", { provider: action.key });
			}
			return ok({ ...next, selectedProvider: action.key, rawText: null });
		}

		case "create": {
			const key = providerKey(action.key);
			if (!key) return fail("Provider key cannot be empty", { field: "key" });
			const result = createProvider(next.draft, key, {});
			if (!result.ok) return fail(result.error.message, { provider: key, field: "key" });
			return ok({
				...next,
				draft: result.value,
				selectedProvider: key,
				rawText: null,
				dirty: true,
			});
		}

		case "rename": {
			const source = providerKey(action.from);
			const target = providerKey(action.to);
			if (!source || !target) return fail("Provider key cannot be empty", { field: "key" });

			// Source SecretRef subtree always blocks rename (never bypassed by overwrite-confirmed).
			const blockedSlots = next.secretSlots.filter((s) => isUnderProviderPath(s.path, source));
			if (blockedSlots.length > 0) {
				return fail(
					`Cannot rename: provider contains ${blockedSlots.length} configured secret(s). Replace or remove secrets first.`,
					{ provider: source, field: "key" },
				);
			}

			// Target overwrite would remove target secrets — surface as error unless overwrite-confirmed.
			const targetSecrets = next.secretSlots.filter((s) => isUnderProviderPath(s.path, target));
			if (hasProvider(next.draft, target) && action.conflict !== "overwrite-confirmed") {
				const result = renameProvider(next.draft, source, target, { conflict: "reject" });
				if (!result.ok) {
					const secretHint = targetSecrets.length > 0
						? ` Overwrite would remove ${targetSecrets.length} secret(s).`
						: "";
					return fail(`${result.error.message}.${secretHint} Confirm overwrite to continue.`, {
						provider: source,
						field: "key",
					});
				}
			}

			const result = renameProvider(next.draft, source, target, { conflict: action.conflict });
			if (!result.ok) return fail(result.error.message, { provider: source, field: "key" });

			// Drop slots under overwritten target; source had none.
			const remainingSlots = action.conflict === "overwrite-confirmed"
				? next.secretSlots.filter((s) => !isUnderProviderPath(s.path, target))
				: next.secretSlots;

			return ok({
				...next,
				draft: result.value,
				secretSlots: remainingSlots,
				selectedProvider: target,
				rawText: null,
				dirty: true,
			});
		}

		case "delete": {
			const key = providerKey(action.key);
			if (!key) return fail("Provider key cannot be empty");
			const result = deleteProvider(next.draft, key);
			if (!result.ok) return fail(result.error.message, { provider: key });
			const newSelection = selectAfterDelete(result.value, key, next.selectedProvider);
			const remainingSlots = next.secretSlots.filter((s) => !isUnderProviderPath(s.path, key));
			return ok({
				...next,
				draft: result.value,
				secretSlots: remainingSlots,
				selectedProvider: newSelection,
				rawText: null,
				dirty: true,
			});
		}

		case "set-field": {
			if (!action.key || !hasProvider(next.draft, action.key)) {
				return fail("Provider not found", { provider: action.key });
			}
			const providers = clone(getProviders(next.draft));
			const config = { ...providers[action.key]! };
			// Preserve typed empty values; explicit removal via remove-field.
			(config as Record<string, unknown>)[action.field] = action.value;
			providers[action.key] = config;
			return ok({
				...next,
				draft: { ...clone(next.draft), providers },
				dirty: true,
			});
		}

		case "remove-field": {
			if (!action.key || !hasProvider(next.draft, action.key)) {
				return fail("Provider not found", { provider: action.key });
			}
			const providers = clone(getProviders(next.draft));
			const config = { ...providers[action.key]! };
			delete (config as Record<string, unknown>)[action.field];
			providers[action.key] = config;
			return ok({
				...next,
				draft: { ...clone(next.draft), providers },
				dirty: true,
			});
		}

		case "apply-raw": {
			let parsed: unknown;
			try {
				parsed = JSON.parse(action.text);
			} catch {
				// Preserve buffer for user to fix
				return fail("Invalid JSON", { field: "raw" });
			}
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return fail("Configuration must be a JSON object", { field: "raw" });
			}
			const obj = parsed as ModelsJson;
			if (!obj.providers || typeof obj.providers !== "object" || Array.isArray(obj.providers)) {
				return fail("Configuration must contain a providers object", { field: "raw" });
			}

			const refCheck = validateSecretRefLocations(obj, next.secretSlots);
			if (!refCheck.ok) {
				return refCheck as UiResult<ProviderManagerState>;
			}

			if (refCheck.value.removed.length > 0 && !action.confirmSecretRemoval) {
				return fail(formatSecretRemovalMessage(refCheck.value.removed), { field: "raw" });
			}

			const newKeys = sortedProviderKeys(obj);
			const newSelection = next.selectedProvider && hasProvider(obj, next.selectedProvider)
				? next.selectedProvider
				: newKeys[0] ?? null;

			const remainingSlots = next.secretSlots.filter(
				(s) => !refCheck.value.removed.some((r) => r.ref === s.ref),
			);

			return ok({
				...next,
				draft: clone(obj),
				secretSlots: remainingSlots,
				rawText: null,
				selectedProvider: newSelection,
				dirty: true,
			});
		}

		case "set-raw-text": {
			return ok({ ...next, rawText: action.text });
		}

		case "set-dirty": {
			return ok({ ...next, dirty: true });
		}

		case "clear-errors": {
			return ok({ ...next, errors: [] });
		}

		case "set-errors": {
			return ok({ ...next, errors: action.errors });
		}

		default:
			return fail("Unknown action");
	}
}

// ── API Client ─────────────────────────────────────────────────────

export type ApiClient = {
	fetchState(): Promise<ApiState>;
	saveConfig(draft: WebModelsDraft, revision: ConfigRevision): Promise<ConfigRevision>;
	cancelSession(): Promise<void>;
};

export function createApiClient(token: string): ApiClient {
	const headers = (): Record<string, string> => ({
		Authorization: `Bearer ${token}`,
	});

	return {
		async fetchState(): Promise<ApiState> {
			const res = await fetch("/api/state", { headers: headers() });
			if (!res.ok) throw new Error(`Server error: ${res.status}`);
			return res.json() as Promise<ApiState>;
		},

		async saveConfig(draft: WebModelsDraft, revision: ConfigRevision): Promise<ConfigRevision> {
			const res = await fetch("/api/config", {
				method: "PUT",
				headers: { ...headers(), "Content-Type": "application/json" },
				body: JSON.stringify({ models: draft, expectedRevision: revision }),
			});

			if (res.status === 409) {
				throw Object.assign(
					new Error("Configuration was modified by another process. Please close and reopen this page."),
					{ code: "config_changed" as const },
				);
			}

			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: { message: "Save failed" } }));
				const errMsg = (body as {
					error?: {
						code?: string;
						message?: string;
						issues?: Array<{ path?: string; message: string; code?: string }>;
					};
				}).error;
				throw Object.assign(new Error(errMsg?.message ?? "Save failed"), {
					code: (errMsg?.code ?? "save_failed") as string,
					issues: errMsg?.issues ?? [],
				});
			}

			const result = await res.json() as { revision: ConfigRevision };
			return result.revision;
		},

		async cancelSession(): Promise<void> {
			// No Content-Type / body required (server accepts bare POST).
			try {
				await fetch("/api/cancel", { method: "POST", headers: headers() });
			} catch { /* server may close before response */ }
		},
	};
}

import { randomBytes } from "node:crypto";
import type { ConfigRevision, ModelsSnapshot } from "../../config-core.js";
import { classifyConfigValue } from "../../config-document.js";
import type { ModelsJson, ProviderConfig } from "../../models-json.js";

export type SecretRef = `pi-vendor-secret:${string}`;

export type SecretSlot = {
	ref: SecretRef;
	path: string;
};

export type StoredSecretSlot = SecretSlot & {
	originalValue: string;
	baseRevision: ConfigRevision;
};

export type WebModelsDraft = ModelsJson;

type MaskContext = {
	slots: SecretSlot[];
	secrets: Map<SecretRef, StoredSecretSlot>;
	revision: ConfigRevision;
};

function randomRef(): SecretRef {
	return `pi-vendor-secret:${randomBytes(16).toString("base64url")}`;
}

// RFC 6901 JSON Pointer escaping
function escapePointer(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointerAppend(base: string, segment: string): string {
	return `${base}/${escapePointer(segment)}`;
}

function arrayPointer(base: string, index: number): string {
	return `${base}/${index}`;
}

function isLiteral(value: unknown): value is string {
	return typeof value === "string" && classifyConfigValue(value) === "literal";
}

function maskValue(ctx: MaskContext, path: string, value: unknown): unknown {
	if (!isLiteral(value)) return value;
	const ref = randomRef();
	const slot: StoredSecretSlot = { ref, path, originalValue: value, baseRevision: ctx.revision };
	ctx.slots.push({ ref, path });
	ctx.secrets.set(ref, slot);
	return ref;
}

function maskHeaders(ctx: MaskContext, basePath: string, headers: unknown): Record<string, unknown> {
	if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
		return headers as Record<string, unknown>;
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
		const headerPath = pointerAppend(basePath, key);
		result[key] = isLiteral(value) ? maskValue(ctx, headerPath, value) : value;
	}
	return result;
}

export function maskSnapshot(snapshot: ModelsSnapshot): {
	draft: WebModelsDraft;
	slots: SecretSlot[];
	secrets: Map<SecretRef, StoredSecretSlot>;
} {
	const ctx: MaskContext = {
		slots: [],
		secrets: new Map(),
		revision: snapshot.revision,
	};

	const providers = snapshot.models.providers;
	if (!providers) return { draft: { providers: {} }, slots: [], secrets: new Map() };

	const masked: Record<string, ProviderConfig> = {};

	for (const [pKey, provider] of Object.entries(providers)) {
		const providerPath = pointerAppend("/providers", pKey);
		const maskedProvider: ProviderConfig = { ...provider };

		// Mask apiKey
		if (isLiteral(maskedProvider.apiKey)) {
			maskedProvider.apiKey = maskValue(ctx, pointerAppend(providerPath, "apiKey"), maskedProvider.apiKey) as string;
		}

		// Mask provider headers
		if (maskedProvider.headers) {
			maskedProvider.headers = maskHeaders(ctx, pointerAppend(providerPath, "headers"), maskedProvider.headers) as Record<string, string>;
		}

		// Mask model headers
		if (Array.isArray(maskedProvider.models)) {
			maskedProvider.models = maskedProvider.models.map((model, idx) => {
				const modelPath = arrayPointer(pointerAppend(providerPath, "models"), idx);
				const maskedModel = { ...model };
				if (maskedModel.headers) {
					maskedModel.headers = maskHeaders(ctx, pointerAppend(modelPath, "headers"), maskedModel.headers) as Record<string, string>;
				}
				return maskedModel;
			});
		}

		// Mask modelOverrides headers
		if (maskedProvider.modelOverrides) {
			const overrides: Record<string, unknown> = {};
			for (const [ovKey, override] of Object.entries(maskedProvider.modelOverrides)) {
				const ovPath = pointerAppend(pointerAppend(providerPath, "modelOverrides"), ovKey);
				const maskedOverride = { ...override };
				if (maskedOverride.headers) {
					maskedOverride.headers = maskHeaders(ctx, pointerAppend(ovPath, "headers"), maskedOverride.headers) as Record<string, string>;
				}
				overrides[ovKey] = maskedOverride;
			}
			maskedProvider.modelOverrides = overrides as Record<string, Record<string, unknown>>;
		}

		masked[pKey] = maskedProvider;
	}

	return {
		draft: { ...snapshot.models, providers: masked },
		slots: ctx.slots,
		secrets: ctx.secrets,
	};
}

export function hydrateCommitDraft(
	draft: WebModelsDraft,
	secrets: Map<SecretRef, StoredSecretSlot>,
	expectedRevision: ConfigRevision,
): ModelsJson {
	const remaining = new Set(secrets.keys());

	function walk(value: unknown, path: string): unknown {
		if (typeof value === "string" && value.startsWith("pi-vendor-secret:")) {
			const ref = value as SecretRef;
			const slot = secrets.get(ref);
			if (!slot) {
				throw Object.assign(
					new Error(`Unknown secret reference at ${path}: ${ref}`),
					{ code: "invalid_secret_ref" as const },
				);
			}
			// Exact path and revision check
			if (slot.path !== path) {
				throw Object.assign(
					new Error(`Secret reference moved or copied at ${path} (original: ${slot.path})`),
					{ code: "invalid_secret_ref" as const },
				);
			}
			if (slot.baseRevision !== expectedRevision) {
				throw Object.assign(
					new Error(`Secret reference from wrong revision at ${path}`),
					{ code: "invalid_secret_ref" as const },
				);
			}
			remaining.delete(ref);
			return slot.originalValue;
		}
		if (Array.isArray(value)) {
			return value.map((item, index) => walk(item, `${path}/${index}`));
		}
		if (value !== null && typeof value === "object") {
			const result: Record<string, unknown> = {};
			for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
				const escapedKey = key.replaceAll("~", "~0").replaceAll("/", "~1");
				result[key] = walk(val, `${path}/${escapedKey}`);
			}
			return result;
		}
		return value;
	}

	const hydrated = walk(draft, "") as ModelsJson;

	// Scan for any remaining refs (should have been consumed)
	const scanResult = JSON.stringify(hydrated);
	if (scanResult.includes("pi-vendor-secret:")) {
		throw Object.assign(new Error("Invalid secret reference"), {
			code: "invalid_secret_ref" as const,
			message: "Configuration contains unresolved secret references",
		});
	}

	return hydrated;
}

export function hydrateProviderCredentials(
	providerKey: string,
	provider: ProviderConfig,
	secrets: Map<SecretRef, StoredSecretSlot>,
	expectedRevision: ConfigRevision,
): ProviderConfig {
	const clone = JSON.parse(JSON.stringify(provider)) as ProviderConfig;

	// Hydrate apiKey — authoritative path + revision check, non-consuming
	if (typeof clone.apiKey === "string" && clone.apiKey.startsWith("pi-vendor-secret:")) {
		const ref = clone.apiKey as SecretRef;
		const slot = secrets.get(ref);
		if (!slot) throw Object.assign(new Error("Unknown secret reference in provider credentials"), { code: "invalid_secret_ref" as const });
		const expectedPath = `/providers/${escapePointer(providerKey)}/apiKey`;
		if (slot.path !== expectedPath) {
			throw Object.assign(
				new Error(`Secret reference moved or copied in provider ${providerKey} apiKey (original: ${slot.path})`),
				{ code: "invalid_secret_ref" as const },
			);
		}
		if (slot.baseRevision !== expectedRevision) {
			throw Object.assign(
				new Error(`Secret reference from wrong revision in provider ${providerKey} apiKey`),
				{ code: "invalid_secret_ref" as const },
			);
		}
		clone.apiKey = slot.originalValue;
	}

	// Hydrate headers — authoritative path + revision check per header, non-consuming
	if (clone.headers) {
		const hydrated: Record<string, string> = {};
		for (const [key, value] of Object.entries(clone.headers)) {
			if (typeof value === "string" && value.startsWith("pi-vendor-secret:")) {
				const ref = value as SecretRef;
				const slot = secrets.get(ref);
				if (!slot) throw Object.assign(new Error("Unknown secret reference in provider headers"), { code: "invalid_secret_ref" as const });
				const expectedPath = `/providers/${escapePointer(providerKey)}/headers/${escapePointer(key)}`;
				if (slot.path !== expectedPath) {
					throw Object.assign(
						new Error(`Secret reference moved or copied in provider ${providerKey} headers.${key} (original: ${slot.path})`),
						{ code: "invalid_secret_ref" as const },
					);
				}
				if (slot.baseRevision !== expectedRevision) {
					throw Object.assign(
						new Error(`Secret reference from wrong revision in provider ${providerKey} headers.${key}`),
						{ code: "invalid_secret_ref" as const },
					);
				}
				hydrated[key] = slot.originalValue;
			} else {
				hydrated[key] = value;
			}
		}
		clone.headers = hydrated;
	}

	return clone;
}

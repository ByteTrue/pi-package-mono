// Pure helpers shared by the pi-vendor TUI (TypeScript) and the bundled skill
// script vendor.mjs. No process/env/network access. The .d.ts next to this file
// is the single source of types; tsc never reads the .js (allowJs stays off),
// vitest/jiti/node load it directly. Keep this file dependency-free.

export const CATALOG_SEARCH_MAX_QUERY_BYTES = 512;

// Encode a raw credential for storage in models.json as a Pi config literal:
// '$' -> '$$', and a leading '!' -> '$!' so it can never become a command.
export function encodeConfigLiteral(value) {
	const dollarsEscaped = value.replaceAll("$", () => "$$");
	return dollarsEscaped.startsWith("!") ? "$" + dollarsEscaped : dollarsEscaped;
}

// Remove routing/credential fields (provider/baseUrl/headers/apiKey/authHeader)
// from a copy of an official catalog model template.
export function stripRoutingFields(model) {
	const copy = structuredClone(model);
	for (const field of ["provider", "baseUrl", "headers", "apiKey", "authHeader"]) delete copy[field];
	return copy;
}

function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

// Shape guard for a loaded MODELS catalog: a plain object of providers whose
// values are plain objects of model records.
export function isCatalogObject(catalog) {
	if (!isPlainObject(catalog)) return false;
	for (const providerModels of Object.values(catalog)) {
		if (!isPlainObject(providerModels)) return false;
	}
	return true;
}

// Data-only guard for dynamically imported catalog modules (audit #11): every
// value reachable from MODELS must be plain JSON data. Functions, accessors
// (getters/setters) and class instances can execute or hide code, so they are
// rejected. Cycles are fine (first visit validates the shared subtree).
export function isPlainDataTree(value, seen = new Set()) {
	if (value === null) return true;
	if (typeof value === "object") {
		if (seen.has(value)) return true;
		seen.add(value);
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return false;
		for (const key of Object.keys(value)) {
			const desc = Object.getOwnPropertyDescriptor(value, key);
			if (!desc || typeof desc.get === "function" || typeof desc.set === "function") return false;
			if (!isPlainDataTree(desc.value, seen)) return false;
		}
	}
	return typeof value !== "function";
}

// Search an official catalog with the script's matching semantics. Match rule:
// every whitespace/-/_-separated token must appear in "id newline name" (as-is
// or with separators stripped). Score: 0 normalized-id exact, 1 normalized-id
// prefix, 2 normalized-id substring, 3 token-only. Ordered by score, then id,
// then provider (locale compare); capped at limit. Query is lowercased here.
export function searchCatalogShared(models, query, limit = 50) {
	const needle = query.trim().toLowerCase();
	const normalizedNeedle = needle.replace(/[\s_-]+/g, "");
	const tokens = needle.split(/[^\p{L}\p{N}._-]+/u).filter(Boolean);
	const results = [];
	for (const [provider, entries] of Object.entries(models ?? {})) {
		for (const model of Object.values(entries ?? {})) {
			const id = typeof model?.id === "string" ? model.id : "";
			const name = typeof model?.name === "string" ? model.name : "";
			const haystack = (id + "\n" + name).toLowerCase();
			const normalizedHaystack = haystack.replace(/[\s_-]+/g, "");
			if (!tokens.every((token) => haystack.includes(token) || normalizedHaystack.includes(token.replace(/[\s_-]+/g, "")))) continue;
			const normalizedId = id.toLowerCase().replace(/[\s_-]+/g, "");
			const score = normalizedId === normalizedNeedle ? 0 : normalizedId.startsWith(normalizedNeedle) ? 1 : normalizedId.includes(normalizedNeedle) ? 2 : 3;
			results.push({ score, officialProvider: provider, model });
		}
	}
	results.sort((a, b) => a.score - b.score || a.model.id.localeCompare(b.model.id) || a.officialProvider.localeCompare(b.officialProvider));
	return results.slice(0, limit).map(({ officialProvider, model }) => ({ officialProvider, model }));
}

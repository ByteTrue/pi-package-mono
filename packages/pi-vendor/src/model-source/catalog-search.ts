import { loadOfficialCatalog } from "./official-catalog.js";
import { type OfficialModelChoice, toWebModelConfig } from "./web-model-dto.js";
import { ModelSourceError } from "./model-source-error.js";

const MAX_QUERY_BYTES = 512;
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function utf8ByteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Search the official Pi model catalog for models matching a query string.
 *
 * - Query is matched case-insensitively against `modelId` and `name`.
 * - Query must be ≤512 UTF-8 bytes; invalid input throws `ModelSourceError("invalid_request")`.
 * - `limit` defaults to 50 and is clamped to 1–100.
 * - Catalog unavailable returns an empty array (no throw).
 * - Results are ordered by: exact modelId match first, then prefix matches, then
 *   substring matches; within each group, first-seen catalog order is preserved.
 */
export async function searchOfficialModels(
	query: string,
	limit?: number,
): Promise<OfficialModelChoice[]> {
	if (utf8ByteLength(query) > MAX_QUERY_BYTES) {
		throw new ModelSourceError("invalid_request", "Query exceeds maximum length");
	}

	const effectiveLimit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, limit ?? DEFAULT_LIMIT));

	const catalog = await loadOfficialCatalog();
	if (!catalog) return [];

	const lowerQuery = query.toLowerCase();
	const exact: OfficialModelChoice[] = [];
	const prefix: OfficialModelChoice[] = [];
	const substring: OfficialModelChoice[] = [];

	for (const [provider, providerModels] of Object.entries(catalog)) {
		for (const [modelId, raw] of Object.entries(providerModels)) {
			if (!isRecord(raw)) continue;
			const lowerId = modelId.toLowerCase();
			const lowerName = typeof raw.name === "string" ? raw.name.toLowerCase() : "";

			const idExact = lowerId === lowerQuery;
			const nameExact = lowerName === lowerQuery;
			const idPrefix = !idExact && lowerId.startsWith(lowerQuery);
			const namePrefix = !nameExact && lowerName.startsWith(lowerQuery);
			const idContains = !idExact && !idPrefix && lowerId.includes(lowerQuery);
			const nameContains = !nameExact && !namePrefix && lowerName.includes(lowerQuery);

			if (!(idExact || nameExact || idPrefix || namePrefix || idContains || nameContains)) continue;

			const model = toWebModelConfig(raw);
			if (!model) continue;

			const entry: OfficialModelChoice = { provider, modelId, model };

			if (idExact || nameExact) {
				exact.push(entry);
			} else if (idPrefix || namePrefix) {
				prefix.push(entry);
			} else {
				substring.push(entry);
			}
		}
	}

	const results = [...exact, ...prefix, ...substring];
	return results.slice(0, effectiveLimit);
}

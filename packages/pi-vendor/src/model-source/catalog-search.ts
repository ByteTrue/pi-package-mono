import { CATALOG_SEARCH_MAX_QUERY_BYTES, searchCatalogShared } from "../shared/vendor-shared.js";
import { loadOfficialCatalog } from "./official-catalog.js";
import { ModelSourceError } from "./model-source-error.js";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function utf8ByteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

/**
 * Search the official Pi model catalog for models matching a query string.
 *
 * - Matching follows the bundled script's semantics (tokenized, separator-
 *   insensitive; see src/shared/vendor-shared.js) so TUI and Skill produce the
 *   same candidates for the same query.
 * - Query must be ≤512 UTF-8 bytes; invalid input throws `ModelSourceError("invalid_request")`.
 * - `limit` defaults to 50 and is clamped to 1–100.
 * - Catalog unavailable throws `ModelSourceError("catalog_unavailable")`.
 * - Results are model ids ordered by: exact matches first, then normalized
 *   exact, then token matches, then substring; stable within each group.
 */
export async function searchOfficialModels(
	query: string,
	limit?: number,
): Promise<string[]> {
	if (utf8ByteLength(query) > CATALOG_SEARCH_MAX_QUERY_BYTES) {
		throw new ModelSourceError("invalid_request", "Query exceeds maximum length");
	}

	const effectiveLimit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, limit ?? DEFAULT_LIMIT));

	const catalog = await loadOfficialCatalog();
	if (!catalog) throw new ModelSourceError("catalog_unavailable", "Official model catalog is unavailable");

	return searchCatalogShared(catalog, query, effectiveLimit)
		.map((entry) => (typeof entry.model?.id === "string" ? entry.model.id : ""))
		.filter(Boolean);
}

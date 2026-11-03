import { loadOfficialCatalog } from "./official-catalog.js";
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
export declare function searchOfficialModels(query: string, limit?: number, loadCatalog?: typeof loadOfficialCatalog): Promise<string[]>;

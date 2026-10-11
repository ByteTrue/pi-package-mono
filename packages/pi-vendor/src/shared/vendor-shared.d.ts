export const CATALOG_SEARCH_MAX_QUERY_BYTES: number;

// Encode a raw credential as a Pi config literal ('$' -> '$$', leading '!' -> '$!').
export function encodeConfigLiteral(value: string): string;

// Copy the model and delete routing/credential fields (provider/baseUrl/headers/apiKey/authHeader).
export function stripRoutingFields<T extends object>(model: T): T;

// True when the catalog is a plain object of providers whose values are plain objects.
export function isCatalogObject(catalog: unknown): catalog is Record<string, Record<string, unknown>>;

// True when every value reachable from the value is plain JSON data (no functions/getters/instances).
export function isPlainDataTree(value: unknown, seen?: Set<object>): boolean;

export type SharedCatalogEntry = {
	officialProvider: string;
	model: Record<string, unknown> & { id?: string; name?: string };
};

// Script-semantics catalog search; see the .js implementation for the contract.
export function searchCatalogShared(models: unknown, query: string, limit?: number): SharedCatalogEntry[];

// Candidate paths for the official Pi model catalog, given install roots.
// Roots may be pi-coding-agent package dirs or install prefixes; the returned
// list is ordered best-first and deduplicated. See the .js implementation.
export function candidateCatalogPaths(roots: readonly (string | null | undefined)[]): string[];

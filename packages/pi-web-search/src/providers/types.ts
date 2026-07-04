/**
 * Provider contracts.
 *
 * A provider plays one or both roles:
 *   - SearchProvider exposes `search()` only.
 *   - FullProvider is the intersection — both `search()` and a native `fetch()`,
 *     for vendors (Tavily, Exa, Jina, Firecrawl) whose fetch/scrape endpoints
 *     are worth using directly instead of the generic HTML fallback.
 *
 * The orchestrator narrows on `"fetch" in provider` to dispatch web_fetch.
 */

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface SearchResponse {
	query: string;
	results: SearchResult[];
}

export interface FetchResponse {
	text: string;
	title?: string;
	contentType?: string;
	contentLength?: number;
}

export interface SearchProvider {
	readonly name: string;
	readonly label: string;
	search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse>;
}

export interface FetchProvider {
	readonly name: string;
	readonly label: string;
	fetch(url: string, raw: boolean, signal?: AbortSignal): Promise<FetchResponse>;
}

export type FullProvider = SearchProvider & FetchProvider;

export type AnyProvider = SearchProvider | FullProvider;

export type ProviderRole = "search" | "fetch";

// Credentials handed to a provider factory.
export interface ProviderCredentials {
	apiKey?: string;
	baseUrl?: string;
}

// Per-provider metadata. Drives /web config + key resolution generically, so
// adding a provider means one entry here plus one provider file — the
// orchestrator never changes.
//
//   envVar         — API-key env var (omit for keyless providers like Exa MCP free / Bing)
//   baseUrlEnvVar  — URL env var (set for self-hosted providers)
//   defaultBaseUrl — fallback URL when neither env nor config supplies one
//   roles          — declared capability; runtime dispatch still uses `"fetch" in provider`
//   keyless        — true for providers usable with no key (the free default)
export interface ProviderMeta {
	name: string;
	label: string;
	envVar?: string;
	baseUrlEnvVar?: string;
	defaultBaseUrl?: string;
	roles: ReadonlyArray<ProviderRole>;
	keyless?: boolean;
	/** Where to get a key — shown in /web for unconfigured paid providers. */
	signupUrl?: string;
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface SearchResponse {
	query: string;
	results: SearchResult[];
}

/** Content returned by the package's single SSRF-safe generic fetch transport. */
export interface FetchedContent {
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

export type AnyProvider = SearchProvider;

export interface ProviderCredentials {
	apiKey?: string;
	baseUrl?: string;
}

export interface ProviderMeta {
	name: string;
	label: string;
	envVar?: string;
	baseUrlEnvVar?: string;
	defaultBaseUrl?: string;
	keyless?: boolean;
	/** Where to get a key — shown in /web for unconfigured paid providers. */
	signupUrl?: string;
}

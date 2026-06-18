/** Brave Search — search only. API logic adapted from MIT rpiv-web-tools. */

import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const ENV_VAR = "BRAVE_SEARCH_API_KEY";

interface BraveResponse {
	web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
}

export class BraveProvider implements SearchProvider {
	readonly name = "brave";
	readonly label = "Brave Search";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) {
			throw new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
		}
		const url = new URL(BRAVE_SEARCH_URL);
		url.searchParams.set("q", query);
		url.searchParams.set("count", String(maxResults));
		const res = await fetch(url.toString(), {
			method: "GET",
			headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": this.apiKey },
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} search error (${res.status}): ${await res.text()}`);
		const raw = (await res.json()) as BraveResponse;
		const results: SearchResult[] = (raw.web?.results ?? []).map((r) => ({
			title: r.title ?? "",
			url: r.url ?? "",
			snippet: r.description ?? "",
		}));
		return { query, results };
	}
}

/** Tavily search. API logic adapted from MIT rpiv-web-tools. */

import { fetchWithProxy as fetch } from "../proxy.js";
import { MAX_SEARCH_RESPONSE_BODY_BYTES, readResponseJson, readResponseText } from "../response-body.js";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const ENV_VAR = "TAVILY_API_KEY";

interface TavilySearchResponse {
	results?: Array<{ title?: string; url?: string; content?: string }>;
}

export class TavilyProvider implements SearchProvider {
	readonly name = "tavily";
	readonly label = "Tavily";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) throw new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
		const res = await fetch(TAVILY_SEARCH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ query, max_results: maxResults }),
			signal,
		});
		if (!res.ok) {
			await readResponseText(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
			throw new Error(`${this.label} search error (${res.status})`);
		}
		const raw = await readResponseJson<TavilySearchResponse>(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
		const results: SearchResult[] = (raw.results ?? []).map((result) => ({
			title: result.title ?? "",
			url: result.url ?? "",
			snippet: result.content ?? "",
		}));
		return { query, results };
	}
}

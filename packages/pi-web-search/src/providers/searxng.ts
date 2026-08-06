/** SearXNG self-hosted metasearch JSON API. */

import { fetchWithProxy as fetch } from "../proxy.js";
import { MAX_SEARCH_RESPONSE_BODY_BYTES, readResponseJson, readResponseText } from "../response-body.js";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:8080";

interface SearxngResponse {
	results?: Array<{ title?: string; url?: string; content?: string }>;
}

export class SearxngProvider implements SearchProvider {
	readonly name = "searxng";
	readonly label = "SearXNG (self-hosted)";

	constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		const url = `${this.baseUrl.replace(/\/+$/, "")}/search?${new URLSearchParams({
			q: query,
			format: "json",
			limit: String(maxResults),
		}).toString()}`;
		const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
		if (!res.ok) {
			await readResponseText(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
			throw new Error(`SearXNG error (${res.status}); check the configured URL and JSON format support`);
		}
		const data = await readResponseJson<SearxngResponse>(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
		const results: SearchResult[] = (data.results ?? []).slice(0, maxResults).map((result) => ({
			title: result.title ?? "",
			url: result.url ?? "",
			snippet: result.content ?? "",
		}));
		return { query, results };
	}
}

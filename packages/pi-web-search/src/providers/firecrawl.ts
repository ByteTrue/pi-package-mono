/** Firecrawl search. API logic adapted from MIT rpiv-web-tools. */

import { fetchWithProxy as fetch } from "../proxy.js";
import { MAX_SEARCH_RESPONSE_BODY_BYTES, readResponseJson, readResponseText } from "../response-body.js";
import type { SearchProvider, SearchResult } from "./types.js";

const FIRECRAWL_API = "https://api.firecrawl.dev/v1";
const ENV_VAR = "FIRECRAWL_API_KEY";

interface FirecrawlSearchResponse {
	data?: Array<{ title?: string; url?: string; description?: string }>;
}

export class FirecrawlProvider implements SearchProvider {
	readonly name = "firecrawl";
	readonly label = "Firecrawl";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
		if (!this.apiKey) throw new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
		const res = await fetch(`${FIRECRAWL_API}/search`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ query, limit: maxResults }),
			signal,
		});
		if (!res.ok) {
			await readResponseText(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
			throw new Error(`${this.label} search error (${res.status})`);
		}
		const raw = await readResponseJson<FirecrawlSearchResponse>(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
		const results: SearchResult[] = (raw.data ?? []).map((result) => ({
			title: result.title ?? "",
			url: result.url ?? "",
			snippet: result.description ?? "",
		}));
		return results;
	}
}

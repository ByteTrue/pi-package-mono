/** Jina s.jina.ai search. Adapted from MIT rpiv-web-tools. */

import { fetchWithProxy as fetch } from "../proxy.js";
import { MAX_SEARCH_RESPONSE_BODY_BYTES, readResponseJson, readResponseText } from "../response-body.js";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const JINA_SEARCH_URL = "https://s.jina.ai/";
const ENV_VAR = "JINA_API_KEY";

interface JinaSearchResponse {
	data?: { results?: Array<{ title?: string; url?: string; description?: string }> };
}

export class JinaProvider implements SearchProvider {
	readonly name = "jina";
	readonly label = "Jina";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) throw new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
		const url = new URL(`${JINA_SEARCH_URL}${encodeURIComponent(query)}`);
		url.searchParams.set("num", String(maxResults));
		const res = await fetch(url.toString(), {
			method: "GET",
			headers: { Accept: "application/json", Authorization: `Bearer ${this.apiKey}` },
			signal,
		});
		if (!res.ok) {
			await readResponseText(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
			throw new Error(`${this.label} search error (${res.status})`);
		}
		const raw = await readResponseJson<JinaSearchResponse>(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
		const results: SearchResult[] = (raw.data?.results ?? [])
			.map((result) => ({ title: result.title ?? "", url: result.url ?? "", snippet: result.description ?? "" }))
			.slice(0, maxResults);
		return { query, results };
	}
}

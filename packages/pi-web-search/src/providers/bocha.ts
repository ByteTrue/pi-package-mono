/** Bocha (博查) Chinese AI-search API. */

import { fetchWithProxy as fetch } from "../proxy.js";
import { MAX_SEARCH_RESPONSE_BODY_BYTES, readResponseJson, readResponseText } from "../response-body.js";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const BOCHA_SEARCH_URL = "https://api.bochaai.com/v1/web-search";
const ENV_VAR = "BOCHA_API_KEY";

interface BochaResponse {
	data?: { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string; summary?: string }> } };
}

export class BochaProvider implements SearchProvider {
	readonly name = "bocha";
	readonly label = "Bocha (博查)";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) throw new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
		const res = await fetch(BOCHA_SEARCH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ query, summary: true, count: maxResults, freshness: "noLimit" }),
			signal,
		});
		if (!res.ok) {
			await readResponseText(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
			throw new Error(`${this.label} search error (${res.status})`);
		}
		const raw = await readResponseJson<BochaResponse>(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
		const results: SearchResult[] = (raw.data?.webPages?.value ?? []).slice(0, maxResults).map((result) => ({
			title: result.name ?? "",
			url: result.url ?? "",
			snippet: result.summary || result.snippet || "",
		}));
		return { query, results };
	}
}

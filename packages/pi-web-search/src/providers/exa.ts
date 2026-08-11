/** Exa semantic search. API logic adapted from MIT rpiv-web-tools. */

import { fetchWithProxy as fetch } from "../proxy.js";
import { MAX_SEARCH_RESPONSE_BODY_BYTES, readResponseJson, readResponseText } from "../response-body.js";
import type { SearchProvider, SearchResult } from "./types.js";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const ENV_VAR = "EXA_API_KEY";
const MAX_SNIPPET_CHARS = 300;

interface ExaResponse {
	results?: Array<{ title?: string; url?: string; text?: string }>;
}

export class ExaProvider implements SearchProvider {
	readonly name = "exa";
	readonly label = "Exa";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
		if (!this.apiKey) throw new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
		const res = await fetch(EXA_SEARCH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
			body: JSON.stringify({ query, numResults: maxResults, contents: { text: { maxCharacters: MAX_SNIPPET_CHARS } } }),
			signal,
		});
		if (!res.ok) {
			await readResponseText(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
			throw new Error(`${this.label} search error (${res.status})`);
		}
		const raw = await readResponseJson<ExaResponse>(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
		const results: SearchResult[] = (raw.results ?? []).map((result) => ({
			title: result.title ?? "",
			url: result.url ?? "",
			snippet: result.text ?? "",
		}));
		return results;
	}
}

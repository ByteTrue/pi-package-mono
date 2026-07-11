/** Exa — semantic search + contents. API logic adapted from MIT rpiv-web-tools. */

import { fetchWithProxy as fetch } from "../proxy.js";
import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.js";
import { readResponseJson, readResponseText } from "../response-body.js";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const ENV_VAR = "EXA_API_KEY";
const MAX_SNIPPET_CHARS = 300;
const MAX_FETCH_CHARS = 10000;

interface ExaRawResult {
	title?: string;
	url?: string;
	text?: string;
}
interface ExaResponse {
	results?: ExaRawResult[];
}

function missingKey(): Error {
	return new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
}

export class ExaProvider implements FullProvider {
	readonly name = "exa";
	readonly label = "Exa";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) throw missingKey();
		const res = await fetch(EXA_SEARCH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
			body: JSON.stringify({ query, numResults: maxResults, contents: { text: { maxCharacters: MAX_SNIPPET_CHARS } } }),
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} search error (${res.status}): ${await readResponseText(res)}`);
		const raw = await readResponseJson<ExaResponse>(res);
		const results: SearchResult[] = (raw.results ?? []).map((r) => ({
			title: r.title ?? "",
			url: r.url ?? "",
			snippet: r.text ?? "",
		}));
		return { query, results };
	}

	async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
		if (!this.apiKey) throw missingKey();
		const res = await fetch(EXA_CONTENTS_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
			body: JSON.stringify({ ids: [url], text: { maxCharacters: MAX_FETCH_CHARS } }),
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} fetch error (${res.status}): ${await readResponseText(res)}`);
		const data = await readResponseJson<ExaResponse>(res);
		const result = data.results?.[0];
		if (!result?.text) throw new Error(`${this.label}: no content returned for ${url}`);
		return { text: result.text, title: result.title || undefined, contentType: "text/plain" };
	}
}

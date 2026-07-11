/** Jina — s.jina.ai search + r.jina.ai reader. Adapted from MIT rpiv-web-tools. */

import { fetchWithProxy as fetch } from "../proxy.js";
import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.js";
import { readResponseJson, readResponseText } from "../response-body.js";

const JINA_SEARCH_URL = "https://s.jina.ai/";
const JINA_READER_URL = "https://r.jina.ai/";
const ENV_VAR = "JINA_API_KEY";

interface JinaSearchResponse {
	data?: { results?: Array<{ title?: string; url?: string; description?: string }> };
}

function missingKey(): Error {
	return new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
}

export class JinaProvider implements FullProvider {
	readonly name = "jina";
	readonly label = "Jina";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) throw missingKey();
		const url = new URL(`${JINA_SEARCH_URL}${encodeURIComponent(query)}`);
		url.searchParams.set("num", String(maxResults));
		const res = await fetch(url.toString(), {
			method: "GET",
			headers: { Accept: "application/json", Authorization: `Bearer ${this.apiKey}` },
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} search error (${res.status}): ${await readResponseText(res)}`);
		const raw = await readResponseJson<JinaSearchResponse>(res);
		const results: SearchResult[] = (raw.data?.results ?? [])
			.map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.description ?? "" }))
			.slice(0, maxResults);
		return { query, results };
	}

	async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
		if (!this.apiKey) throw missingKey();
		// No Accept header → Reader returns markdown by default.
		const res = await fetch(`${JINA_READER_URL}${url}`, {
			method: "GET",
			headers: { Authorization: `Bearer ${this.apiKey}` },
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} fetch error (${res.status}): ${await readResponseText(res)}`);
		const text = await readResponseText(res);
		if (!text.trim()) throw new Error(`${this.label}: no content returned for ${url}`);
		return { text, contentType: "text/markdown" };
	}
}

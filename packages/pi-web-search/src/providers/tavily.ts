/** Tavily — search + extract. API logic adapted from MIT rpiv-web-tools. */

import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.js";
import { readResponseJson, readResponseText } from "../response-body.js";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const ENV_VAR = "TAVILY_API_KEY";

interface TavilyRawResult {
	title?: string;
	url?: string;
	content?: string;
}
interface TavilySearchResponse {
	results?: TavilyRawResult[];
}
interface TavilyExtractResponse {
	results?: Array<{ url?: string; raw_content?: string }>;
	failed_results?: Array<{ url?: string; error?: string }>;
}

function missingKey(): Error {
	return new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
}

export class TavilyProvider implements FullProvider {
	readonly name = "tavily";
	readonly label = "Tavily";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) throw missingKey();
		const res = await fetch(TAVILY_SEARCH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ query, max_results: maxResults }),
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} search error (${res.status}): ${await readResponseText(res)}`);
		const raw = await readResponseJson<TavilySearchResponse>(res);
		const results: SearchResult[] = (raw.results ?? []).map((r) => ({
			title: r.title ?? "",
			url: r.url ?? "",
			snippet: r.content ?? "",
		}));
		return { query, results };
	}

	async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
		if (!this.apiKey) throw missingKey();
		const res = await fetch(TAVILY_EXTRACT_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ urls: [url] }),
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} fetch error (${res.status}): ${await readResponseText(res)}`);
		const data = await readResponseJson<TavilyExtractResponse>(res);
		const failed = data.failed_results?.[0];
		if (failed) throw new Error(`${this.label} extraction failed for ${failed.url ?? url}: ${failed.error ?? "unknown"}`);
		const result = data.results?.[0];
		if (!result?.raw_content) throw new Error(`${this.label}: no content returned for ${url}`);
		return { text: result.raw_content, contentType: "text/plain" };
	}
}

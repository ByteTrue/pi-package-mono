/** Firecrawl — search + scrape. API logic adapted from MIT rpiv-web-tools. */

import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.js";
import { readResponseJson, readResponseText } from "../response-body.js";

const FIRECRAWL_API = "https://api.firecrawl.dev/v1";
const ENV_VAR = "FIRECRAWL_API_KEY";

interface FirecrawlSearchResponse {
	data?: Array<{ title?: string; url?: string; description?: string }>;
}
interface FirecrawlScrapeResponse {
	success?: boolean;
	data?: { markdown?: string; metadata?: { title?: string } };
	error?: string;
}

function missingKey(): Error {
	return new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
}

export class FirecrawlProvider implements FullProvider {
	readonly name = "firecrawl";
	readonly label = "Firecrawl";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) throw missingKey();
		const res = await fetch(`${FIRECRAWL_API}/search`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ query, limit: maxResults }),
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} search error (${res.status}): ${await readResponseText(res)}`);
		const raw = await readResponseJson<FirecrawlSearchResponse>(res);
		const results: SearchResult[] = (raw.data ?? []).map((r) => ({
			title: r.title ?? "",
			url: r.url ?? "",
			snippet: r.description ?? "",
		}));
		return { query, results };
	}

	async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
		if (!this.apiKey) throw missingKey();
		const res = await fetch(`${FIRECRAWL_API}/scrape`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ url, formats: ["markdown"] }),
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} fetch error (${res.status}): ${await readResponseText(res)}`);
		const raw = await readResponseJson<FirecrawlScrapeResponse>(res);
		if (!raw.success) throw new Error(`${this.label}: ${raw.error ?? "scrape failed"}`);
		if (!raw.data?.markdown) throw new Error(`${this.label}: no content returned for ${url}`);
		return { text: raw.data.markdown, title: raw.data.metadata?.title || undefined, contentType: "text/markdown" };
	}
}

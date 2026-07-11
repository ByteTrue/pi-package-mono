/**
 * SearXNG — keyless search via self-hosted metasearch engine.
 *
 * SearXNG aggregates 70+ search engines and exposes a clean JSON API.
 * Users must deploy their own instance (Docker or pip) and set SEARXNG_URL.
 * This provider is optional — it only appears in the candidate list when a
 * base URL is configured.
 *
 * API: GET ${baseUrl}/search?q=...&format=json&limit=N
 * Docs: https://docs.searxng.org/dev/search_api.html
 */

import { fetchWithProxy as fetch } from "../proxy.js";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:8080";

interface SearxngResult {
	title?: string;
	url?: string;
	content?: string;
}

interface SearxngResponse {
	results?: SearxngResult[];
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

		const res = await fetch(url, {
			signal,
			headers: { Accept: "application/json" },
		});

		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(`SearXNG error (${res.status}): ${body || "check SEARXNG_URL and that JSON format is enabled"}`);
		}

		const data = (await res.json()) as SearxngResponse;
		const results: SearchResult[] = (data.results ?? []).slice(0, maxResults).map((r) => ({
			title: r.title ?? "",
			url: r.url ?? "",
			snippet: r.content ?? "",
		}));

		return { query, results };
	}
}

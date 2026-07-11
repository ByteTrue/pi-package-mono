/**
 * Bocha (博查) — Chinese AI-search API, reachable from mainland China and
 * purpose-built for LLM/RAG. Keyed (Bearer). DeepSeek's official web-search
 * provider; data stays in-country. Search only.
 *
 * Endpoint: POST https://api.bochaai.com/v1/web-search
 * Response follows the Bing WebSearch schema: data.webPages.value[].
 */

import { fetchWithProxy as fetch } from "../proxy.js";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const BOCHA_SEARCH_URL = "https://api.bochaai.com/v1/web-search";
const ENV_VAR = "BOCHA_API_KEY";

interface BochaResponse {
	data?: {
		webPages?: {
			value?: Array<{ name?: string; url?: string; snippet?: string; summary?: string }>;
		};
	};
	// some responses nest under messages/other keys; we read defensively above
}

export class BochaProvider implements SearchProvider {
	readonly name = "bocha";
	readonly label = "Bocha (博查)";

	constructor(private readonly apiKey: string) {}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		if (!this.apiKey) {
			throw new Error(`${ENV_VAR} is not set. Run /web to configure a key, or export ${ENV_VAR}.`);
		}
		const res = await fetch(BOCHA_SEARCH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({ query, summary: true, count: maxResults, freshness: "noLimit" }),
			signal,
		});
		if (!res.ok) throw new Error(`${this.label} search error (${res.status}): ${await res.text()}`);
		const raw = (await res.json()) as BochaResponse;
		const value = raw.data?.webPages?.value ?? [];
		const results: SearchResult[] = value.slice(0, maxResults).map((r) => ({
			title: r.name ?? "",
			url: r.url ?? "",
			snippet: r.summary || r.snippet || "",
		}));
		return { query, results };
	}
}

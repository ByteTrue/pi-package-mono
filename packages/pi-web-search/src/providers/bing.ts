/** Bing keyless HTML search, including mainland-China redirects. */

import { BROWSER_USER_AGENT, htmlToText } from "../html.js";
import { fetchWithProxy as fetch } from "../proxy.js";
import { MAX_SEARCH_RESPONSE_BODY_BYTES, readResponseText } from "../response-body.js";
import type { SearchProvider, SearchResult } from "./types.js";

const BING_ENDPOINT = "https://www.bing.com/search";
const MAX_ATTEMPTS = 2;
const BASE_BACKOFF_MS = 400;

function cleanText(html: string): string {
	return htmlToText(html).replace(/\s+/g, " ").trim();
}

function decodeBingUrl(href: string): string {
	try {
		const url = new URL(href, "https://www.bing.com");
		if (url.hostname.endsWith("bing.com") && url.pathname.startsWith("/ck/a")) {
			const raw = url.searchParams.get("u");
			if (raw) {
				const decoded = Buffer.from(raw.replace(/^a1/, "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
				if (/^https?:\/\//i.test(decoded)) return decoded;
			}
		}
		return url.toString();
	} catch {
		return href;
	}
}

function parseBing(html: string, maxResults: number): SearchResult[] {
	const results: SearchResult[] = [];
	for (const raw of html.split(/<li class="b_algo"/i).slice(1)) {
		if (results.length >= maxResults) break;
		const end = raw.indexOf("</li>");
		const block = end > 0 ? raw.slice(0, end) : raw;
		const titleMatch = block.match(/<h2\b[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
		if (!titleMatch) continue;
		const url = decodeBingUrl(titleMatch[1] ?? "");
		const title = cleanText(titleMatch[2] ?? "");
		if (!title || !/^https?:\/\//i.test(url)) continue;
		const snippetMatch =
			block.match(/<p class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
			block.match(/<div class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
		results.push({ title, url, snippet: snippetMatch ? cleanText(snippetMatch[1] ?? "") : "" });
	}
	return results;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class BingProvider implements SearchProvider {
	readonly name = "bing";
	readonly label = "Bing";

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
		const url = `${BING_ENDPOINT}?${new URLSearchParams({ q: query, form: "QBLH" }).toString()}`;
		let lastError: unknown;
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			if (signal?.aborted) throw signal.reason ?? new Error("Search aborted");
			if (attempt > 0) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
			try {
				const res = await fetch(url, {
					signal,
					redirect: "follow",
					headers: {
						"User-Agent": BROWSER_USER_AGENT,
						Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
						"Accept-Language": "en-US,en;q=0.9",
					},
				});
				const body = await readResponseText(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
				if (!res.ok) throw new Error(`Bing search error (${res.status})`);
				const results = parseBing(body, maxResults);
				if (results.length > 0) return results;
			} catch (error) {
				if (signal?.aborted) throw error;
				lastError = error;
			}
		}
		if (lastError) throw new Error(`Bing search failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
		return [];
	}
}

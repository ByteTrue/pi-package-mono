/**
 * Bing — keyless scraping of the public search HTML. Reachable from mainland
 * China without a proxy (requests redirect to cn.bing.com), which makes it the
 * China-friendly keyless fallback.
 *
 * Microsoft retired the Bing Search API in Aug 2025, so scraping the HTML
 * endpoint is the remaining keyless route. Same fragility class as any scraper
 * (markup changes, anti-bot), mitigated with browser-like headers and retry.
 */

import { BROWSER_USER_AGENT, htmlToText } from "../html.js";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const BING_ENDPOINT = "https://www.bing.com/search";
const MAX_ATTEMPTS = 2;
const BASE_BACKOFF_MS = 400;

function cleanText(html: string): string {
	return htmlToText(html).replace(/\s+/g, " ").trim();
}

// Bing wraps some links as bing.com/ck/a?...&u=a1<base64url>. Decode to the real
// target; pass through direct hrefs (organic results are usually already direct).
function decodeBingUrl(href: string): string {
	try {
		const u = new URL(href, "https://www.bing.com");
		if (u.hostname.endsWith("bing.com") && u.pathname.startsWith("/ck/a")) {
			const raw = u.searchParams.get("u");
			if (raw) {
				const b64 = raw.replace(/^a1/, "").replace(/-/g, "+").replace(/_/g, "/");
				const decoded = Buffer.from(b64, "base64").toString("utf8");
				if (/^https?:\/\//i.test(decoded)) return decoded;
			}
		}
		return u.toString();
	} catch {
		return href;
	}
}

function parseBing(html: string, maxResults: number): SearchResult[] {
	const results: SearchResult[] = [];
	const blocks = html.split(/<li class="b_algo"/i).slice(1);
	for (const raw of blocks) {
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
		const snippet = snippetMatch ? cleanText(snippetMatch[1] ?? "") : "";

		results.push({ title, url, snippet });
	}
	return results;
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BingProvider implements SearchProvider {
	readonly name = "bing";
	readonly label = "Bing";

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		const url = `${BING_ENDPOINT}?${new URLSearchParams({ q: query, form: "QBLH" }).toString()}`;
		let lastError: unknown;

		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			if (signal?.aborted) throw new Error("Search aborted");
			if (attempt > 0) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
			try {
				const res = await fetch(url, {
					signal,
					redirect: "follow",
					headers: {
						"User-Agent": BROWSER_USER_AGENT,
						Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
						// Neutral — we hit www.bing.com and let Bing geo-redirect by IP
						// on its own; we don't steer toward any region.
						"Accept-Language": "en-US,en;q=0.9",
					},
				});
				const body = await res.text();
				const results = parseBing(body, maxResults);
				if (results.length > 0) return { query, results };
			} catch (err) {
				if (signal?.aborted) throw err;
				lastError = err;
			}
		}

		if (lastError) throw new Error(`Bing search failed: ${(lastError as Error).message ?? lastError}`);
		return { query, results: [] };
	}
}

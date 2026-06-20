/**
 * DuckDuckGo — the keyless, zero-config default search provider.
 *
 * There is no official DuckDuckGo search API. Like the community-standard
 * `ddgs` library (and every "free web search" agent tool), this scrapes the
 * non-JavaScript HTML endpoints:
 *   - primary:  https://html.duckduckgo.com/html/    (GET, reliable when sent
 *               browser-like Accept-Language + Referer headers)
 *   - fallback: https://lite.duckduckgo.com/lite/    (POST form, lighter HTML)
 *
 * Both endpoints serve a 202 anti-bot challenge unless the request looks like a
 * real browser — Accept-Language and Referer are the headers that flip 202→200.
 *
 * Caveats baked into the design: no SLA, ~20–30 req/min/IP before a temporary
 * block (HTTP 202 / challenge page), and occasional markup changes. We mitigate
 * with browser-like headers, exponential backoff retry, rate-limit detection,
 * and an endpoint fallback. On hard rate-limit we throw an actionable error.
 */

import { BROWSER_USER_AGENT, htmlToText } from "../html.js";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const LITE_ENDPOINT = "https://lite.duckduckgo.com/lite/";
const HTML_ENDPOINT = "https://html.duckduckgo.com/html/";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

const RATE_LIMIT_HINT =
	"DuckDuckGo rate-limited the request (it has no official API and throttles after ~20–30 searches/min). " +
	"Wait a minute and retry, or run /web to configure a key-backed provider (Tavily, Brave, Exa) for higher reliability.";

// ---------------------------------------------------------------------------
// URL decoding
// ---------------------------------------------------------------------------

// DDG wraps outbound links as //duckduckgo.com/l/?uddg=<encoded target>&...
// Unwrap to the real destination; pass through anything already direct.
function decodeDdgUrl(href: string): string {
	let raw = href.trim();
	if (raw.startsWith("//")) raw = `https:${raw}`;
	try {
		const u = new URL(raw, "https://duckduckgo.com");
		if (u.hostname.endsWith("duckduckgo.com") && u.pathname.startsWith("/l/")) {
			const target = u.searchParams.get("uddg");
			if (target) return decodeURIComponent(target);
		}
		return u.toString();
	} catch {
		return href;
	}
}

function cleanText(html: string): string {
	return htmlToText(html).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Parsers — one per endpoint, both zip title/url anchors with snippet cells.
// ---------------------------------------------------------------------------

interface RawHit {
	url: string;
	title: string;
}

function extractAnchors(html: string, classToken: string): RawHit[] {
	const re = new RegExp(`<a\\b[^>]*class=["'][^"']*${classToken}[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi");
	const hrefRe = /href=["']([^"']+)["']/i;
	const hits: RawHit[] = [];
	for (const m of html.matchAll(re)) {
		const tag = m[0];
		const hrefMatch = tag.match(hrefRe);
		if (!hrefMatch) continue;
		const title = cleanText(m[1] ?? "");
		if (!title) continue;
		hits.push({ url: decodeDdgUrl(hrefMatch[1] ?? ""), title });
	}
	return hits;
}

function extractCells(html: string, tag: string, classToken: string): string[] {
	const re = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*${classToken}[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
	return [...html.matchAll(re)].map((m) => cleanText(m[1] ?? ""));
}

function zipResults(hits: RawHit[], snippets: string[], maxResults: number): SearchResult[] {
	const results: SearchResult[] = [];
	for (let i = 0; i < hits.length && results.length < maxResults; i++) {
		const hit = hits[i];
		if (!hit) continue;
		// Skip DDG's own ad / internal links.
		if (!/^https?:\/\//i.test(hit.url) || /duckduckgo\.com\/y\.js/.test(hit.url)) continue;
		results.push({ title: hit.title, url: hit.url, snippet: snippets[i] ?? "" });
	}
	return results;
}

function parseLite(html: string, maxResults: number): SearchResult[] {
	const hits = extractAnchors(html, "result-link");
	const snippets = extractCells(html, "td", "result-snippet");
	return zipResults(hits, snippets, maxResults);
}

function parseHtml(html: string, maxResults: number): SearchResult[] {
	const hits = extractAnchors(html, "result__a");
	const snippets = extractCells(html, "a", "result__snippet");
	return zipResults(hits, snippets, maxResults);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function looksRateLimited(status: number, body: string): boolean {
	if (status === 202 || status === 429) return true;
	// DDG's anti-bot interstitial.
	return /anomaly|are you a robot|unusual traffic/i.test(body) && body.length < 4000;
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Headers that make DDG serve real results (200) instead of the 202 challenge.
// Accept-Language and Referer are the decisive ones.
const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent": BROWSER_USER_AGENT,
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
};

async function requestHtml(query: string, signal?: AbortSignal): Promise<{ status: number; body: string }> {
	const url = `${HTML_ENDPOINT}?${new URLSearchParams({ q: query }).toString()}`;
	const res = await fetch(url, {
		signal,
		redirect: "follow",
		headers: { ...BROWSER_HEADERS, Referer: "https://duckduckgo.com/" },
	});
	return { status: res.status, body: await res.text() };
}

async function requestLite(query: string, signal?: AbortSignal): Promise<{ status: number; body: string }> {
	const res = await fetch(LITE_ENDPOINT, {
		method: "POST",
		signal,
		redirect: "follow",
		headers: {
			...BROWSER_HEADERS,
			"Content-Type": "application/x-www-form-urlencoded",
			Referer: "https://lite.duckduckgo.com/",
			Origin: "https://lite.duckduckgo.com",
		},
		body: new URLSearchParams({ q: query }).toString(),
	});
	return { status: res.status, body: await res.text() };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class DuckDuckGoProvider implements SearchProvider {
	readonly name = "duckduckgo";
	readonly label = "DuckDuckGo";

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		// html (GET) is the reliable endpoint; lite (POST) is the lighter
		// fallback. Try html twice (with backoff) before falling back to lite.
		const plan: Array<"html" | "lite"> = ["html", "html", "lite"];
		let rateLimited = false;
		let lastError: unknown;

		for (let attempt = 0; attempt < plan.length; attempt++) {
			if (signal?.aborted) throw new Error("Search aborted");
			if (attempt > 0) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));

			const endpoint = plan[attempt];
			try {
				const { status, body } =
					endpoint === "html" ? await requestHtml(query, signal) : await requestLite(query, signal);
				if (looksRateLimited(status, body)) {
					rateLimited = true;
					continue;
				}
				const results = endpoint === "html" ? parseHtml(body, maxResults) : parseLite(body, maxResults);
				if (results.length > 0) return { query, results };
				// 200 but nothing parsed: fall through to the next endpoint/attempt.
			} catch (err) {
				if (signal?.aborted) throw err;
				lastError = err;
			}
		}

		if (rateLimited) throw new Error(RATE_LIMIT_HINT);
		if (lastError) throw new Error(`DuckDuckGo search failed: ${(lastError as Error).message ?? lastError}`);
		// Genuinely no results across both endpoints.
		return { query, results: [] };
	}
}

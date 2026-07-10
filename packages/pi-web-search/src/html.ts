/**
 * Shared HTTP + HTML helpers.
 *
 * Ported and trimmed from the MIT-licensed rpiv-web-tools fetch-helpers:
 *   - htmlToText / extractTitle  — tag-stripping HTML → readable text
 *   - SSRF guard                 — reject private / loopback / link-local hosts
 *   - fetchViaGenericHtml        — the keyless web_fetch path used when the
 *     active provider has no native fetch endpoint
 */

import type { FetchResponse } from "./providers/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// A real browser UA — some hosts refuse the bot-shaped default fetch UA.
// bot-shaped default fetch UA.
export const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FETCH_ACCEPT_HEADER = "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5";
const BINARY_CONTENT_TYPE_PREFIXES = ["image/", "video/", "audio/"];
const HTML_CONTENT_TYPE_TOKEN = "text/html";

const SUPPORTED_HTTP_PROTOCOLS = new Set(["http:", "https:"]);

// ---------------------------------------------------------------------------
// HTML-to-text extraction
// ---------------------------------------------------------------------------

const SCRIPT_BLOCK_REGEX = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK_REGEX = /<style[\s\S]*?<\/style>/gi;
const NOSCRIPT_BLOCK_REGEX = /<noscript[\s\S]*?<\/noscript>/gi;
const BLOCK_CLOSER_REGEX =
	/<\/(p|div|h[1-6]|li|tr|br|blockquote|pre|section|article|header|footer|nav|details|summary)>/gi;
const SELF_CLOSING_BR_REGEX = /<br\s*\/?>/gi;
const ANY_REMAINING_TAG_REGEX = /<[^>]+>/g;
const TITLE_TAG_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const NUMERIC_HTML_ENTITY_REGEX = /&#(\d+);/g;
const HEX_HTML_ENTITY_REGEX = /&#x([0-9a-fA-F]+);/g;
const HORIZONTAL_WHITESPACE_RUN = /[ \t]+/g;
const BLANK_LINE_RUN = /\n{3,}/g;

function stripNonContentBlocks(html: string): string {
	return html.replace(SCRIPT_BLOCK_REGEX, "").replace(STYLE_BLOCK_REGEX, "").replace(NOSCRIPT_BLOCK_REGEX, "");
}

function convertBlockTagsToNewlines(text: string): string {
	return text.replace(BLOCK_CLOSER_REGEX, "\n").replace(SELF_CLOSING_BR_REGEX, "\n");
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;|&ensp;|&emsp;|&thinsp;/g, " ")
		.replace(/&hellip;/g, "…")
		.replace(/&mdash;/g, "—")
		.replace(/&ndash;/g, "–")
		.replace(/&middot;/g, "·")
		.replace(HEX_HTML_ENTITY_REGEX, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
		.replace(NUMERIC_HTML_ENTITY_REGEX, (_, code) => String.fromCodePoint(Number(code)));
}

function collapseWhitespace(text: string): string {
	return text.replace(HORIZONTAL_WHITESPACE_RUN, " ").replace(BLANK_LINE_RUN, "\n\n");
}

export function htmlToText(html: string): string {
	let text = stripNonContentBlocks(html);
	text = convertBlockTagsToNewlines(text);
	text = text.replace(ANY_REMAINING_TAG_REGEX, " ");
	text = decodeHtmlEntities(text);
	text = collapseWhitespace(text);
	return text.trim();
}

export function extractTitle(html: string): string | undefined {
	const match = html.match(TITLE_TAG_REGEX);
	if (!match) return undefined;
	return match[1]?.replace(ANY_REMAINING_TAG_REGEX, "").trim() || undefined;
}

// ---------------------------------------------------------------------------
// Content-type guards
// ---------------------------------------------------------------------------

export function isHtmlContentType(contentType: string): boolean {
	return contentType.includes(HTML_CONTENT_TYPE_TOKEN);
}

export function assertTextContentType(contentType: string): void {
	if (BINARY_CONTENT_TYPE_PREFIXES.some((prefix) => contentType.includes(prefix))) {
		throw new Error(`Unsupported content type: ${contentType}. web_fetch supports text pages only.`);
	}
}

// ---------------------------------------------------------------------------
// URL guard (SSRF)
// ---------------------------------------------------------------------------

function isPrivateOrLoopbackHostname(hostname: string): boolean {
	const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (h === "localhost" || h.endsWith(".localhost")) return true;
	// IPv6 loopback / unspecified / link-local / unique-local
	if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
	// IPv4 literals
	const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!v4) return false;
	const a = Number(v4[1]);
	const b = Number(v4[2]);
	if (a === 0 || a === 127 || a === 10) return true; // 0.0.0.0/8, loopback, RFC1918
	if (a === 169 && b === 254) return true; // link-local (incl. AWS metadata 169.254.169.254)
	if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16.0.0/12
	if (a === 192 && b === 168) return true; // RFC1918 192.168.0.0/16
	return false;
}

export function parseAndAssertHttpUrl(raw: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`Invalid URL: ${raw}`);
	}
	if (!SUPPORTED_HTTP_PROTOCOLS.has(parsed.protocol)) {
		throw new Error(`Unsupported URL protocol: ${parsed.protocol}. Only http and https are supported.`);
	}
	if (isPrivateOrLoopbackHostname(parsed.hostname)) {
		throw new Error(`Refusing to fetch private/loopback address: ${parsed.hostname}`);
	}
	return parsed;
}

// ---------------------------------------------------------------------------
// HTTP fetch
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 5;

export function buildFetchRequestInit(signal: AbortSignal | undefined): RequestInit {
	return {
		signal,
		// Manual redirects so each hop re-runs the SSRF host check.
		redirect: "manual",
		headers: { "User-Agent": BROWSER_USER_AGENT, Accept: FETCH_ACCEPT_HEADER },
	};
}

function isRedirectStatus(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function fetchUrlOrThrow(url: string, signal: AbortSignal | undefined): Promise<Response> {
	// Re-check the start URL (callers may skip parseAndAssertHttpUrl).
	let current = parseAndAssertHttpUrl(url).toString();
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const res = await fetch(current, buildFetchRequestInit(signal));
		if (isRedirectStatus(res.status)) {
			const location = res.headers.get("location");
			if (!location) {
				throw new Error(`HTTP ${res.status} redirect without Location for ${current}`);
			}
			if (hop === MAX_REDIRECTS) {
				throw new Error(`Too many redirects (max ${MAX_REDIRECTS}) for ${url}`);
			}
			// Absolute or relative Location; still must be http(s) + non-private.
			current = parseAndAssertHttpUrl(new URL(location, current).toString()).toString();
			continue;
		}
		if (!res.ok) {
			throw new Error(`HTTP ${res.status} ${res.statusText} for ${current}`);
		}
		return res;
	}
	throw new Error(`Too many redirects (max ${MAX_REDIRECTS}) for ${url}`);
}

async function extractBodyAsText(
	res: Response,
	contentType: string,
	raw: boolean,
): Promise<{ text: string; title?: string }> {
	const body = await res.text();
	if (!raw && isHtmlContentType(contentType)) {
		return { text: htmlToText(body), title: extractTitle(body) };
	}
	return { text: body };
}

// Keyless web_fetch path: fetch → content-type assert → body extraction →
// FetchResponse envelope. Used when the active provider has no native fetch().
export async function fetchViaGenericHtml(url: string, raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
	const res = await fetchUrlOrThrow(url, signal);
	const contentType = res.headers.get("content-type") ?? "";
	assertTextContentType(contentType);
	const { text, title } = await extractBodyAsText(res, contentType, raw);
	const contentLengthHeader = res.headers.get("content-length");
	return {
		text,
		title,
		contentType: contentType || undefined,
		contentLength: contentLengthHeader ? Number(contentLengthHeader) : undefined,
	};
}

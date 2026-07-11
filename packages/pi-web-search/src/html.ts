/**
 * Shared HTTP + HTML helpers.
 *
 * Ported and trimmed from the MIT-licensed rpiv-web-tools fetch-helpers:
 *   - htmlToText / extractTitle  — tag-stripping HTML → readable text
 *   - SSRF guard                 — reject private / loopback / link-local hosts
 *   - fetchViaGenericHtml        — the keyless web_fetch path used when the
 *     active provider has no native fetch endpoint
 */

import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, ProxyAgent, type Dispatcher, type RequestInit as UndiciRequestInit } from "undici";
import type { FetchResponse } from "./providers/types.js";
import { getInstalledProxyUrl } from "./proxy.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// A real browser UA — some hosts refuse the bot-shaped default fetch UA.
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

const NON_PUBLIC_IPS = new BlockList();
const GLOBALLY_REACHABLE_SPECIALS = new BlockList();
GLOBALLY_REACHABLE_SPECIALS.addAddress("192.0.0.9", "ipv4");
GLOBALLY_REACHABLE_SPECIALS.addAddress("192.0.0.10", "ipv4");
for (const [network, prefix] of [
	["2001:1::1", 128],
	["2001:1::2", 128],
	["2001:1::3", 128],
	["2001:3::", 32],
	["2001:4:112::", 48],
	["2001:20::", 28],
	["2001:30::", 28],
] as const) {
	GLOBALLY_REACHABLE_SPECIALS.addSubnet(network, prefix, "ipv6");
}
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.2", 32],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	NON_PUBLIC_IPS.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["64:ff9b:1::", 48],
	["100::", 64],
	["100:0:0:1::", 64],
	["2001::", 23],
	["2001:db8::", 32],
	["2002::", 16],
	["3fff::", 20],
	["5f00::", 16],
	["fc00::", 7],
	["fe80::", 10],
	["fec0::", 10],
	["ff00::", 8],
] as const) {
	NON_PUBLIC_IPS.addSubnet(network, prefix, "ipv6");
}

interface ResolvedAddress {
	address: string;
	family: number;
}

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

function normalizeHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

function parseIpv6Words(address: string): number[] {
	const [left = "", right = ""] = address.toLowerCase().split("::");
	const parseSide = (side: string): number[] => {
		if (!side) return [];
		const segments = side.split(":");
		const last = segments.at(-1);
		if (last?.includes(".")) {
			segments.pop();
			const bytes = last.split(".").map(Number);
			segments.push(((bytes[0] ?? 0) * 256 + (bytes[1] ?? 0)).toString(16));
			segments.push(((bytes[2] ?? 0) * 256 + (bytes[3] ?? 0)).toString(16));
		}
		return segments.map((segment) => Number.parseInt(segment, 16));
	};
	const leading = parseSide(left);
	const trailing = parseSide(right);
	const fill = address.includes("::") ? Array(Math.max(0, 8 - leading.length - trailing.length)).fill(0) : [];
	return [...leading, ...fill, ...trailing];
}

function nat64EmbeddedIpv4(address: string): string | undefined {
	const words = parseIpv6Words(address);
	if (words.length !== 8 || words[0] !== 0x64 || words[1] !== 0xff9b || words.slice(2, 6).some(Boolean)) return undefined;
	const high = words[6] ?? 0;
	const low = words[7] ?? 0;
	return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isIpv4MappedIpv6(address: string): boolean {
	const words = parseIpv6Words(address);
	return words.length === 8 && words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
}

function isNonPublicIpAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return true;
	if (family === 6 && isIpv4MappedIpv6(address)) return true;
	const type = family === 6 ? "ipv6" : "ipv4";
	if (GLOBALLY_REACHABLE_SPECIALS.check(address, type)) return false;
	if (family === 6) {
		const embedded = nat64EmbeddedIpv4(address);
		if (embedded) return isNonPublicIpAddress(embedded);
	}
	return NON_PUBLIC_IPS.check(address, type);
}

function isPrivateOrLoopbackHostname(hostname: string): boolean {
	const normalized = normalizeHostname(hostname);
	if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
	return isIP(normalized) !== 0 && isNonPublicIpAddress(normalized);
}

async function resolveHostname(hostname: string): Promise<ResolvedAddress[]> {
	return lookup(hostname, { all: true, verbatim: true });
}

async function assertPublicResolution(hostname: string, resolver: HostResolver): Promise<ResolvedAddress[]> {
	const normalized = normalizeHostname(hostname);
	const family = isIP(normalized);
	const addresses = family === 0 ? await resolver(normalized) : [{ address: normalized, family }];
	if (addresses.length === 0) throw new Error(`Could not resolve URL host: ${normalized}`);
	for (const { address } of addresses) {
		if (isNonPublicIpAddress(address)) {
			throw new Error(`Refusing to fetch hostname ${normalized} resolved to private/loopback address: ${address}`);
		}
	}
	return addresses;
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

export function createSsrfSafeDirectAgent(resolver: HostResolver = resolveHostname): Agent {
	const safeLookup: LookupFunction = (hostname, options, callback) => {
		void assertPublicResolution(hostname, resolver).then(
			(addresses) => {
				if (options.all) {
					callback(null, addresses);
					return;
				}
				const selected = addresses[0];
				if (!selected) {
					callback(new Error(`Could not resolve URL host: ${hostname}`), "", 0);
					return;
				}
				callback(null, selected.address, selected.family);
			},
			(error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), "", 0),
		);
	};
	return new Agent({ connect: { lookup: safeLookup } });
}

const ssrfSafeDirectAgent = createSsrfSafeDirectAgent();
const cachedProxies = new Map<string, ProxyAgent>();

function cleanupCachedProxies(): void {
	const active = new Set([getInstalledProxyUrl("http:"), getInstalledProxyUrl("https:")].filter(Boolean));
	for (const [url, dispatcher] of cachedProxies) {
		if (active.has(url)) continue;
		void dispatcher.close().catch(() => {});
		cachedProxies.delete(url);
	}
}

function fetchDispatcher(protocol: "http:" | "https:"): Dispatcher {
	cleanupCachedProxies();
	const proxyUrl = getInstalledProxyUrl(protocol);
	if (!proxyUrl) return ssrfSafeDirectAgent;
	let dispatcher = cachedProxies.get(proxyUrl);
	if (!dispatcher) {
		dispatcher = new ProxyAgent(proxyUrl);
		cachedProxies.set(proxyUrl, dispatcher);
	}
	return dispatcher;
}

async function assertDirectPublicResolution(
	url: URL,
	resolver: HostResolver,
	dispatcherOverride: Dispatcher | undefined,
): Promise<void> {
	const protocol = url.protocol as "http:" | "https:";
	if (dispatcherOverride || !getInstalledProxyUrl(protocol)) await assertPublicResolution(url.hostname, resolver);
}

function buildFetchRequestInit(
	signal: AbortSignal | undefined,
	dispatcher: Dispatcher,
): UndiciRequestInit {
	return {
		signal,
		redirect: "manual",
		headers: { "User-Agent": BROWSER_USER_AGENT, Accept: FETCH_ACCEPT_HEADER },
		dispatcher,
	};
}

function isRedirectStatus(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function fetchUrlOrThrow(
	url: string,
	signal: AbortSignal | undefined,
	resolver: HostResolver = resolveHostname,
	dispatcher?: Dispatcher,
): Promise<Response> {
	let parsed = parseAndAssertHttpUrl(url);
	await assertDirectPublicResolution(parsed, resolver, dispatcher);
	let current = parsed.toString();
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const activeDispatcher = dispatcher ?? fetchDispatcher(parsed.protocol as "http:" | "https:");
		const res = (await undiciFetch(current, buildFetchRequestInit(signal, activeDispatcher))) as unknown as Response;
		if (isRedirectStatus(res.status)) {
			const location = res.headers.get("location");
			await res.body?.cancel().catch(() => {});
			if (!location) {
				throw new Error(`HTTP ${res.status} redirect without Location for ${current}`);
			}
			if (hop === MAX_REDIRECTS) {
				throw new Error(`Too many redirects (max ${MAX_REDIRECTS}) for ${url}`);
			}
			parsed = parseAndAssertHttpUrl(new URL(location, current).toString());
			await assertDirectPublicResolution(parsed, resolver, dispatcher);
			current = parsed.toString();
			continue;
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
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
	try {
		assertTextContentType(contentType);
	} catch (error) {
		await res.body?.cancel().catch(() => {});
		throw error;
	}
	const { text, title } = await extractBodyAsText(res, contentType, raw);
	const contentLengthHeader = res.headers.get("content-length");
	return {
		text,
		title,
		contentType: contentType || undefined,
		contentLength: contentLengthHeader ? Number(contentLengthHeader) : undefined,
	};
}

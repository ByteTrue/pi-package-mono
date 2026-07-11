/**
 * Search with automatic provider fallback.
 *
 * Tries the active provider first, then every other available provider
 * (keyless, or keyed with a resolvable key), stopping at the first that returns
 * results. A dead/blocked/rate-limited provider therefore no longer requires a
 * manual /web switch. Kept free of TUI deps so it is unit-testable.
 */

import { getActiveProviderName, resolveApiKey, resolveBaseUrl, type WebConfig } from "./config.js";
import { createProvider } from "./providers/factory.js";
import { PROVIDERS } from "./providers/registry.js";
import type { SearchResult } from "./providers/types.js";

export const SEARCH_PROVIDER_TIMEOUT_MS = 15_000;
export const MAX_SEARCH_RESULT_BYTES = 64 * 1024;
export const MAX_SEARCH_TITLE_BYTES = 512;
export const MAX_SEARCH_URL_BYTES = 4_096;
export const MAX_SEARCH_SNIPPET_BYTES = 2_048;
export const MAX_SEARCH_ERROR_BYTES = 512;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class SearchAttemptTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`timed out after ${timeoutMs}ms`);
		this.name = "SearchAttemptTimeoutError";
	}
}

function truncateUtf8(value: unknown, maxBytes: number): { text: string; bytes: number } {
	const text = String(value ?? "");
	const encoded = textEncoder.encode(text);
	if (encoded.byteLength <= maxBytes) return { text, bytes: encoded.byteLength };
	let end = maxBytes;
	// Back up from UTF-8 continuation bytes so the prefix ends on a code-point boundary.
	while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end--;
	return { text: textDecoder.decode(encoded.subarray(0, end)), bytes: end };
}

export function normalizeSearchResults(
	results: SearchResult[],
	maxResults: number,
	totalBudget: number = MAX_SEARCH_RESULT_BYTES,
): SearchResult[] {
	const normalized: SearchResult[] = [];
	let remaining = totalBudget;
	for (const result of results.slice(0, maxResults)) {
		if (remaining <= 0) break;
		const title = truncateUtf8(result.title, Math.min(MAX_SEARCH_TITLE_BYTES, remaining));
		remaining -= title.bytes;
		const url = truncateUtf8(result.url, Math.min(MAX_SEARCH_URL_BYTES, remaining));
		remaining -= url.bytes;
		const snippet = truncateUtf8(result.snippet, Math.min(MAX_SEARCH_SNIPPET_BYTES, remaining));
		remaining -= snippet.bytes;
		normalized.push({ title: title.text, url: url.text, snippet: snippet.text });
	}
	return normalized;
}

async function searchProviderWithTimeout(
	provider: ReturnType<typeof createProvider>,
	query: string,
	maxResults: number,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<{ results: SearchResult[] }> {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new RangeError("timeoutMs must be a non-negative safe integer");
	if (signal?.aborted) throw signal.reason ?? new Error("Search aborted");
	const controller = new AbortController();
	const timeoutError = new SearchAttemptTimeoutError(timeoutMs);
	let timedOut = false;
	const onExternalAbort = () => controller.abort(signal?.reason ?? new Error("Search aborted"));
	signal?.addEventListener("abort", onExternalAbort, { once: true });
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(timeoutError);
	}, timeoutMs);
	timer.unref();
	let onAttemptAbort = () => {};
	const aborted = new Promise<never>((_, reject) => {
		onAttemptAbort = () => reject(controller.signal.reason ?? new Error("Search aborted"));
		controller.signal.addEventListener("abort", onAttemptAbort, { once: true });
	});
	try {
		const response = await Promise.race([provider.search(query, maxResults, controller.signal), aborted]);
		if (signal?.aborted) throw signal.reason ?? new Error("Search aborted");
		return response;
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		if (timedOut) throw timeoutError;
		throw error;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onExternalAbort);
		controller.signal.removeEventListener("abort", onAttemptAbort);
	}
}

export interface SearchOutcome {
	backend: string;
	results: SearchResult[];
	/** Per-provider notes ("name: 0 results" / "name: <error>") for providers that didn't win. */
	attempted: string[];
	/** True when the winner was not the first (active) candidate. */
	fellBack: boolean;
}

export interface SearchProgress {
	provider: string;
	label: string;
	index: number;
	/** Name of the provider that just failed, when this is a fallback attempt. */
	previousFailure?: string;
}

function hasExplicitBaseUrl(name: string, config: WebConfig): boolean {
	const meta = PROVIDERS.find((p) => p.name === name);
	if (!meta?.baseUrlEnvVar) return true;
	return Boolean(process.env[meta.baseUrlEnvVar]?.trim() || config.baseUrls?.[name]?.trim());
}
// Active provider first, then other available search providers in registry order.
export function buildSearchCandidates(config: WebConfig): string[] {
	const active = getActiveProviderName(config);
	const available = PROVIDERS.filter(
		(p) =>
			p.roles.includes("search") &&
			((p.keyless && hasExplicitBaseUrl(p.name, config)) || resolveApiKey(p.name, config) !== undefined),
	).map((p) => p.name);
	return [active, ...available.filter((n) => n !== active)];
}

export async function searchWithFallback(
	config: WebConfig,
	query: string,
	maxResults: number,
	signal: AbortSignal | undefined,
	onProgress?: (p: SearchProgress) => void,
	attemptTimeoutMs: number = SEARCH_PROVIDER_TIMEOUT_MS,
): Promise<SearchOutcome> {
	const candidates =
		config.autoFallback === false ? [getActiveProviderName(config)] : buildSearchCandidates(config);

	const attempted: string[] = [];
	let anySucceeded = false;
	let lastError: unknown;

	for (let i = 0; i < candidates.length; i++) {
		if (signal?.aborted) throw signal.reason ?? new Error("Search aborted");
		const name = candidates[i];
		if (!name) continue;
		let provider: ReturnType<typeof createProvider>;
		try {
			provider = createProvider(name, { apiKey: resolveApiKey(name, config), baseUrl: resolveBaseUrl(name, config) });
		} catch {
			continue; // unknown provider name in config — skip
		}

		onProgress?.({ provider: name, label: provider.label, index: i, previousFailure: i > 0 ? candidates[i - 1] : undefined });

		try {
			const response = await searchProviderWithTimeout(provider, query, maxResults, signal, attemptTimeoutMs);
			anySucceeded = true;
			const results = normalizeSearchResults(response.results, maxResults);
			if (results.length > 0) {
				return { backend: name, results, attempted, fellBack: i > 0 };
			}
			attempted.push(`${name}: 0 results`);
		} catch (err) {
			if (signal?.aborted) throw err;
			const message = truncateUtf8(err instanceof Error ? err.message : String(err), MAX_SEARCH_ERROR_BYTES).text;
			attempted.push(`${name}: ${message}`);
			lastError = err;
		}
	}

	// Every candidate threw (none even returned an empty set): a real failure.
	if (!anySucceeded && lastError) {
		throw new Error(`All search providers failed. Tried — ${attempted.join("; ")}.`);
	}
	return { backend: candidates[0] ?? "", results: [], attempted, fellBack: false };
}

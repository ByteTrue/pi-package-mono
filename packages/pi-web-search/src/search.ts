import { getProviderChain, resolveApiKey, resolveBaseUrl, type WebConfig } from "./config.js";
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
): Promise<SearchResult[]> {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new RangeError("timeoutMs must be a non-negative safe integer");
	if (signal?.aborted) throw signal.reason ?? new Error("Search aborted");
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const attemptSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
	let onAttemptAbort = () => {};
	const aborted = new Promise<never>((_, reject) => {
		onAttemptAbort = () => reject(attemptSignal.reason ?? new Error("Search aborted"));
		attemptSignal.addEventListener("abort", onAttemptAbort, { once: true });
	});
	try {
		const results = await Promise.race([provider.search(query, maxResults, attemptSignal), aborted]);
		if (signal?.aborted) throw signal.reason ?? new Error("Search aborted");
		return results;
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		if (timeoutSignal.aborted) throw new SearchAttemptTimeoutError(timeoutMs);
		throw error;
	} finally {
		attemptSignal.removeEventListener("abort", onAttemptAbort);
	}
}

function hasExplicitBaseUrl(name: string, config: WebConfig): boolean {
	const meta = PROVIDERS.find((provider) => provider.name === name);
	if (!meta?.baseUrlEnvVar) return true;
	return Boolean(process.env[meta.baseUrlEnvVar]?.trim() || config.baseUrls?.[name]?.trim());
}

export function listAvailableSearchProviders(config: WebConfig): string[] {
	return PROVIDERS.filter(
		(provider) =>
			(provider.keyless && hasExplicitBaseUrl(provider.name, config)) ||
			resolveApiKey(provider.name, config) !== undefined,
	).map((provider) => provider.name);
}

export interface SearchOutcome {
	backend: string;
	results: SearchResult[];
	attemptedProviders: string[];
}

export interface SearchProgress {
	provider: string;
	label: string;
}

/** Try the configured provider chain in order; explicit provider calls remain single-provider. */
export async function searchWithProvider(
	config: WebConfig,
	providerName: string | undefined,
	query: string,
	maxResults: number,
	signal: AbortSignal | undefined,
	onProgress?: (progress: SearchProgress) => void,
	attemptTimeoutMs: number = SEARCH_PROVIDER_TIMEOUT_MS,
): Promise<SearchOutcome> {
	const names = providerName?.trim() ? [providerName.trim()] : getProviderChain(config);
	const attemptedProviders: string[] = [];
	const failures: string[] = [];

	for (const name of names) {
		if (signal?.aborted) throw signal.reason ?? new Error("Search aborted");
		attemptedProviders.push(name);

		let provider: ReturnType<typeof createProvider>;
		try {
			provider = createProvider(name, {
				apiKey: resolveApiKey(name, config),
				baseUrl: resolveBaseUrl(name, config),
			});
		} catch (error) {
			const message = truncateUtf8(error instanceof Error ? error.message : String(error), MAX_SEARCH_ERROR_BYTES).text;
			failures.push(`${name}: ${message}`);
			continue;
		}

		onProgress?.({ provider: name, label: provider.label });
		try {
			const results = await searchProviderWithTimeout(provider, query, maxResults, signal, attemptTimeoutMs);
			return { backend: name, results: normalizeSearchResults(results, maxResults), attemptedProviders };
		} catch (error) {
			if (signal?.aborted) throw error;
			const message = truncateUtf8(error instanceof Error ? error.message : String(error), MAX_SEARCH_ERROR_BYTES).text;
			failures.push(`${name}: ${message}`);
		}
	}

	const details = failures.join("; ");
	throw new Error(truncateUtf8(`All configured search providers failed: ${details || "none configured"}`, MAX_SEARCH_ERROR_BYTES).text);
}

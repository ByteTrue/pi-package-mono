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
): Promise<SearchOutcome> {
	const candidates =
		config.autoFallback === false ? [getActiveProviderName(config)] : buildSearchCandidates(config);

	const attempted: string[] = [];
	let anySucceeded = false;
	let lastError: unknown;

	for (let i = 0; i < candidates.length; i++) {
		if (signal?.aborted) throw new Error("Search aborted");
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
			const response = await provider.search(query, maxResults, signal);
			anySucceeded = true;
			if (response.results.length > 0) {
				return { backend: name, results: response.results, attempted, fellBack: i > 0 };
			}
			attempted.push(`${name}: 0 results`);
		} catch (err) {
			if (signal?.aborted) throw err;
			attempted.push(`${name}: ${(err as Error).message ?? String(err)}`);
			lastError = err;
		}
	}

	// Every candidate threw (none even returned an empty set): a real failure.
	if (!anySucceeded && lastError) {
		throw new Error(`All search providers failed. Tried — ${attempted.join("; ")}.`);
	}
	return { backend: candidates[0] ?? "", results: [], attempted, fellBack: false };
}

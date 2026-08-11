// Shared "acquire exactly one model" step for both /vendor TUI flows.
// One model per run: list upstream ids when possible, otherwise take a typed
// id, then resolve the official template with explicit disambiguation.

import { fuzzyFilter } from "../fuzzy.js";
import type { ProviderModelConfig } from "../models-json.js";
import { discoverModelIds } from "../model-source/bounded-discover.js";
import { searchOfficialModels } from "../model-source/catalog-search.js";
import { enrichModelId, type EnrichOptions } from "../model-source/enrich.js";
import { ModelSourceError } from "../model-source/model-source-error.js";
import { formatOfficialCandidate, stripOfficialRoutingFields } from "../model-source/official-catalog.js";
import type { QuickUI } from "./quick-adapter.js";

/** Above this many upstream ids, offer a fuzzy filter before the select. */
const FILTER_THRESHOLD = 20;

/** Documented maximum for searchOfficialModels; one provider can hold dozens of variants. */
const CATALOG_SEARCH_LIMIT = 100;

export type ProviderTarget = {
	baseUrl: string;
	api?: string;
	apiKey?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
	/** On-disk credential snapshot; required before any `!command` value may run. */
	initialProvider?: { apiKey?: string; headers?: Record<string, string> };
};

/** Test seams; production calls the real catalog and discovery. */
export type AcquireOptions = {
	enrich?: EnrichOptions;
	discover?: typeof discoverModelIds;
	searchCatalog?: typeof searchOfficialModels;
};

/**
 * Acquire exactly one model for `provider`.
 * Returns null when the user cancels at any step.
 */
export async function acquireOneModel(
	ui: QuickUI,
	provider: ProviderTarget,
	options: AcquireOptions = {},
): Promise<ProviderModelConfig | null> {
	const ids = await listUpstreamIds(ui, provider, options.discover ?? discoverModelIds);
	const modelId = ids
		? await pickModelId(ui, ids)
		: await promptModelId(ui, options.searchCatalog ?? searchOfficialModels);
	if (modelId === null) return null;
	return resolveModelConfig(ui, modelId, provider, options.enrich);
}

/** Pick one id from a possibly long upstream list, with an optional fuzzy filter. */
export async function pickModelId(ui: QuickUI, ids: string[]): Promise<string | null> {
	let pool = ids;
	if (ids.length > FILTER_THRESHOLD) {
		const query = await ui.input({
			message: `${ids.length} models upstream. Filter (Enter to list all):`,
			placeholder: "e.g. claude, gpt-5, qwen",
		});
		if (query === null) return null;
		if (query.trim()) {
			const filtered = fuzzyFilter(ids, query, (id) => id);
			if (filtered.length === 0) {
				ui.notify(`No upstream id matches "${query.trim()}". Listing all.`, "warning");
			} else {
				pool = filtered;
			}
		}
	}
	return ui.select({
		message: "Select model:",
		choices: pool.map((id) => ({ value: id, label: id })),
	});
}

/**
 * Resolve the model config for `modelId` against the official catalog.
 * - no candidate: minimal entry, reported to the user
 * - one candidate: applied automatically, source reported
 * - several candidates: the user picks the official source provider
 */
export async function resolveModelConfig(
	ui: QuickUI,
	modelId: string,
	provider: ProviderTarget,
	enrichOptions?: EnrichOptions,
): Promise<ProviderModelConfig | null> {
	const enriched = await enrichModelId(modelId, enrichOptions);

	if (enriched.kind === "ready") {
		if (enriched.warning) ui.notify(enriched.warning, "warning");
		return applyProviderRouting(enriched.model, provider);
	}

	const candidates = enriched.candidates;
	const only = candidates.length === 1 ? candidates[0] : undefined;
	if (only) {
		ui.notify(`Using official template from ${only.provider}.`, "info");
		return applyProviderRouting(stripOfficialRoutingFields(only.model), provider);
	}

	const picked = await ui.select({
		message: `"${modelId}" has ${candidates.length} official templates. Select source:`,
		choices: candidates.map((candidate, index) => ({
			value: String(index),
			label: formatOfficialCandidate(candidate),
		})),
	});
	if (picked === null) return null;
	const chosen = candidates[Number(picked)];
	if (!chosen) return null;
	return applyProviderRouting(stripOfficialRoutingFields(chosen.model), provider);
}

/**
 * Inherit the provider api when the template has none, then apply the
 * anthropic-messages rule: that adapter appends its own `/v1`, so a provider
 * baseUrl already ending in `/v1` needs a per-model override without it.
 */
function applyProviderRouting(model: ProviderModelConfig, provider: ProviderTarget): ProviderModelConfig {
	const next: ProviderModelConfig = { ...model };
	if (!next.api && provider.api) next.api = provider.api;
	if (next.api === "anthropic-messages") {
		const withoutV1 = stripTrailingV1(provider.baseUrl);
		if (withoutV1 !== null) next.baseUrl = withoutV1;
	}
	return next;
}

/** Return `baseUrl` without a trailing `/v1` path segment, or null when absent. */
export function stripTrailingV1(baseUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		return null;
	}
	const path = url.pathname.replace(/\/+$/, "");
	if (!path.endsWith("/v1")) return null;
	url.pathname = path.slice(0, -"/v1".length);
	return url.toString().replace(/\/+$/, "");
}

/**
 * List upstream model ids, or null when unavailable so the caller falls back
 * to a typed id. Never blocks the flow on a discovery failure.
 */
async function listUpstreamIds(
	ui: QuickUI,
	provider: ProviderTarget,
	discover: typeof discoverModelIds,
): Promise<string[] | null> {
	if (hasUntrustedCommandCredential(provider)) {
		ui.notify("Provider uses command-based credentials that are not saved yet; enter a model id instead.", "info");
		return null;
	}

	ui.notify(`Listing ${provider.api ?? "OpenAI-compatible"} models …`, "info");
	try {
		const ids = await discover(
			{ baseUrl: provider.baseUrl, api: provider.api, apiKey: provider.apiKey, headers: provider.headers, authHeader: provider.authHeader },
			provider.initialProvider ? { initialProvider: provider.initialProvider } : {},
		);
		if (ids.length === 0) {
			ui.notify("Provider returned no models; enter a model id instead.", "warning");
			return null;
		}
		return ids;
	} catch (error) {
		// Discovery errors are typed constants; anything else stays unreported.
		const reason = error instanceof ModelSourceError ? error.message : "unexpected error";
		ui.notify(`Could not list upstream models (${reason}); enter a model id instead.`, "warning");
		return null;
	}
}

/** A `!command` credential may only run against an on-disk snapshot. */
function hasUntrustedCommandCredential(provider: ProviderTarget): boolean {
	if (provider.initialProvider) return false;
	const values = [provider.apiKey, ...Object.values(provider.headers ?? {})];
	return values.some((value) => typeof value === "string" && value.startsWith("!"));
}

/** Sentinel for "ignore the catalog matches and take my text literally". */
const USE_LITERAL = "\u0000literal";

async function promptModelId(
	ui: QuickUI,
	searchCatalog: typeof searchOfficialModels,
): Promise<string | null> {
	for (;;) {
		const input = await ui.input({
			message: "Model id (searches the official catalog):",
			placeholder: "e.g. opus, gpt-5, my-custom-model",
		});
		if (input === null) return null;
		const trimmed = input.trim();
		if (!trimmed) {
			ui.notify("Model id cannot be empty.", "warning");
			continue;
		}
		return resolveTypedId(ui, trimmed, searchCatalog);
	}
}

/**
 * Users type fragments ("opus"), not exact catalog keys, so search the official
 * catalog for the text and let them pick an id. The literal text stays
 * reachable for genuinely custom models.
 */
async function resolveTypedId(
	ui: QuickUI,
	text: string,
	searchCatalog: typeof searchOfficialModels,
): Promise<string | null> {
	let matches: string[] = [];
	try {
		const results = await searchCatalog(text, CATALOG_SEARCH_LIMIT);
		matches = results;
	} catch {
		// Catalog trouble must not block a custom id.
	}

	if (matches.length === 0) return text;
	if (matches.length === 1 && matches[0] === text) return text;

	// Catalog order groups by provider, which buries plain ids under dozens of
	// regional variants. Rank with the shared scorer so "opus" surfaces
	// claude-opus-4-5 ahead of global.anthropic.claude-opus-4-5-20251101-v1:0.
	const ranked = fuzzyFilter(matches, text, (id) => id);
	const ordered = ranked.length > 0 ? ranked : matches;

	const picked = await ui.select({
		message: `Official catalog matches for "${text}":`,
		choices: [
			...ordered.map((id) => ({ value: id, label: id })),
			{ value: USE_LITERAL, label: `Use "${text}" as a custom id` },
		],
	});
	if (picked === null) return null;
	return picked === USE_LITERAL ? text : picked;
}

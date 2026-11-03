import type { ProviderModelConfig } from "../models-json.js";
import { discoverModelIds } from "../model-source/bounded-discover.js";
import { searchOfficialModels } from "../model-source/catalog-search.js";
import { type EnrichOptions } from "../model-source/enrich.js";
import type { QuickUI } from "./quick-adapter.js";
export type ProviderTarget = {
    baseUrl: string;
    api?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    authHeader?: boolean;
    /** On-disk credential snapshot; required before any `!command` value may run. */
    initialProvider?: {
        apiKey?: string;
        headers?: Record<string, string>;
    };
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
export declare function acquireOneModel(ui: QuickUI, provider: ProviderTarget, options?: AcquireOptions): Promise<ProviderModelConfig | null>;
/** Pick one id from a possibly long upstream list, with an optional fuzzy filter. */
export declare function pickModelId(ui: QuickUI, ids: string[]): Promise<string | null>;
/**
 * Resolve the model config for `modelId` against the official catalog.
 * - catalog unavailable: minimal entry, reported as an environment problem
 * - no candidate: minimal entry, reported to the user
 * - one candidate: applied automatically, source reported
 * - several candidates: the user picks the official source provider
 */
export declare function resolveModelConfig(ui: QuickUI, modelId: string, provider: ProviderTarget, enrichOptions?: EnrichOptions): Promise<ProviderModelConfig | null>;
/** Return `baseUrl` without a trailing `/v1` path segment, or null when absent. */
export declare function stripTrailingV1(baseUrl: string): string | null;
/**
 * Return `baseUrl` normalized to a trailing `/v1beta` path segment (replacing
 * a trailing `/v1` when present), or null when it already ends in `/v1beta`.
 */
export declare function toGoogleV1Beta(baseUrl: string): string | null;

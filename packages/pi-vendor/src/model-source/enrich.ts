import type { ProviderModelConfig } from "../models-json.js";
import {
	collectOfficialCandidates,
	type OfficialModelCandidate,
	type OfficialModelsCatalog,
	loadOfficialCatalog,
} from "./official-catalog.js";

export type ModelEnrichmentReady = {
	kind: "ready";
	model: ProviderModelConfig;
	warning?: string;
};

export type ModelEnrichmentAmbiguous = {
	kind: "official-ambiguous";
	modelId: string;
	candidates: OfficialModelCandidate[];
};

/**
 * The official catalog could not be located or loaded, so nothing is known
 * about this id. Kept separate from `ready` with a warning: "the catalog is
 * missing" and "this id is genuinely custom" call for different user action,
 * and conflating them produced the misleading "no official catalog match"
 * message for every model (see byissue/issues/113-x-vendor-catalog-lookup.md).
 */
export type ModelEnrichmentCatalogUnavailable = {
	kind: "catalog-unavailable";
	modelId: string;
	/** The minimal entry the caller may still use if the user accepts it. */
	model: ProviderModelConfig;
	warning: string;
};

export type ModelEnrichmentResult =
	| ModelEnrichmentReady
	| ModelEnrichmentAmbiguous
	| ModelEnrichmentCatalogUnavailable;

export type EnrichOptions = {
	catalog?: OfficialModelsCatalog | null;
};

export async function enrichModelId(modelId: string, options: EnrichOptions = {}): Promise<ModelEnrichmentResult> {
	const catalog = Object.hasOwn(options, "catalog") ? options.catalog : await loadOfficialCatalog();

	// A missing catalog means the lookup never happened; do not report it as a
	// missing model.
	if (catalog === null || catalog === undefined) {
		return {
			kind: "catalog-unavailable",
			modelId,
			model: { id: modelId },
			warning: `Official catalog unavailable; using a minimal entry for ${modelId}. Metadata (context window, cost, compat) is unknown.`,
		};
	}

	const candidates = collectOfficialCandidates(catalog, modelId);
	if (candidates.length > 0) return { kind: "official-ambiguous", modelId, candidates };

	return {
		kind: "ready",
		model: { id: modelId },
		warning: `No official catalog match for ${modelId}; using a minimal model entry.`,
	};
}

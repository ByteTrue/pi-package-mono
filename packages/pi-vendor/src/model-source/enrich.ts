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

export type ModelEnrichmentResult = ModelEnrichmentReady | ModelEnrichmentAmbiguous;

export type EnrichOptions = {
	catalog?: OfficialModelsCatalog | null;
};

export async function enrichModelId(modelId: string, options: EnrichOptions = {}): Promise<ModelEnrichmentResult> {
	const catalog = Object.hasOwn(options, "catalog") ? options.catalog : await loadOfficialCatalog();
	const candidates = collectOfficialCandidates(catalog, modelId);
	if (candidates.length > 0) return { kind: "official-ambiguous", modelId, candidates };

	return {
		kind: "ready",
		model: { id: modelId },
		warning: `No official catalog match for ${modelId}; using a minimal model entry.`,
	};
}

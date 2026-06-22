import type { ProviderModelConfig } from "./models-json.js";
import {
	collectOfficialCandidates,
	type OfficialModelCandidate,
	type OfficialModelsCatalog,
	loadOfficialCatalog,
	stripOfficialRoutingFields,
} from "./official-catalog.js";
import {
	createDefaultModelConfig,
	createTemplateModelConfig,
	matchTemplate,
	type ModelTemplate,
} from "./templates.js";

export type ModelEnrichmentReady = {
	kind: "ready";
	source: "official" | "template" | "default";
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
	templates?: readonly ModelTemplate[];
};

export async function enrichModelId(modelId: string, options: EnrichOptions = {}): Promise<ModelEnrichmentResult> {
	const catalog = options.catalog ?? (await loadOfficialCatalog());
	const officialCandidates = collectOfficialCandidates(catalog, modelId);

	// Always require user confirmation when we have official candidates (even just 1)
	if (officialCandidates.length >= 1) {
		return {
			kind: "official-ambiguous",
			modelId,
			candidates: officialCandidates,
		};
	}

	const template = matchTemplate(modelId, options.templates);
	if (template) {
		return {
			kind: "ready",
			source: "template",
			model: createTemplateModelConfig(modelId, template),
		};
	}

	return {
		kind: "ready",
		source: "default",
		model: createDefaultModelConfig(modelId),
		warning: `No official catalog or template match for ${modelId}; using safe defaults.`,
	};
}

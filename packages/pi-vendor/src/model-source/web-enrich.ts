import { enrichModelId, type EnrichOptions, type ModelEnrichmentResult } from "./enrich.js";
import type { OfficialModelChoice, WebModelEnrichmentResult } from "./web-model-dto.js";
import { toWebModelConfig } from "./web-model-dto.js";

/**
 * Enrich a model id for Web (browser) consumption.
 *
 * Wraps the raw enrichment pipeline and projects all model configs
 * through `toWebModelConfig()` so the result contains only closed,
 * safe DTOs without routing fields, credentials, or unknown compat keys.
 *
 * Returns the same shape as `ModelEnrichmentResult` but with
 * `WebModelConfig` / `OfficialModelChoice` instead of raw config types.
 */
export async function enrichModelForWeb(
	modelId: string,
	options: EnrichOptions = {},
): Promise<WebModelEnrichmentResult> {
	const raw = await enrichModelId(modelId, options);

	if (raw.kind === "official-ambiguous") {
		const candidates: OfficialModelChoice[] = [];
		for (const candidate of raw.candidates) {
			if (!candidate.model || typeof candidate.model !== "object") continue;
			const model = toWebModelConfig(candidate.model as Record<string, unknown>);
			if (!model) continue;
			candidates.push({ provider: candidate.provider, modelId: candidate.model.id as string, model });
		}
		if (candidates.length === 0) {
			// Fallback: all candidates failed DTO projection, treat as default
			return {
				kind: "ready",
				source: "default",
				model: { id: modelId },
				warning: `No valid official catalog entry for ${modelId}; using safe defaults.`,
			};
		}
		return { kind: "official-candidates", modelId, candidates };
	}

	// "ready" case: project the model through closed mapper
	const model = toWebModelConfig(raw.model as Record<string, unknown>);
	if (!model) {
		return {
			kind: "ready",
			source: "default",
			model: { id: modelId },
			warning: `Could not project model ${modelId}; using safe defaults.`,
		};
	}
	const result: WebModelEnrichmentResult = { kind: "ready", source: raw.source, model };
	if (raw.warning) result.warning = raw.warning;
	return result;
}

/**
 * Enrich a model id for TUI (Node-only) consumption.
 *
 * Returns the raw `ModelEnrichmentResult` without DTO projection.
 * Callers MUST strip routing fields via `stripOfficialRoutingFields()`
 * before writing to models.json.
 */
export async function enrichModelForTui(
	modelId: string,
	options: EnrichOptions = {},
): Promise<ModelEnrichmentResult> {
	return enrichModelId(modelId, options);
}

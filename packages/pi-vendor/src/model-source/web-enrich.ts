import { enrichModelId, type EnrichOptions, type ModelEnrichmentResult } from "./enrich.js";

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

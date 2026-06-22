import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerVendorCommand } from "./command.js";

export { registerVendorCommand } from "./command.js";
export type { ModelEnrichmentAmbiguous, ModelEnrichmentReady, ModelEnrichmentResult } from "./enrich.js";
export { enrichModelId } from "./enrich.js";
export type { ModelsJson, ProviderConfig, ProviderDraft, ProviderModelConfig } from "./models-json.js";
export {
	createMinimalProviderConfig,
	createNewProviderDraft,
	createProviderDraft,
	getModelsJsonPath,
	readModelsJson,
	upsertProvider,
	writeModelsJson,
} from "./models-json.js";
export type { OfficialModelCandidate, OfficialModelsCatalog, OfficialModelConfig } from "./official-catalog.js";
export {
	collectOfficialCandidates,
	findOfficialCatalogPath,
	formatOfficialCandidate,
	loadOfficialCatalog,
	stripOfficialRoutingFields,
} from "./official-catalog.js";
export type { FetchLike, OpenAIModelsProviderDraft } from "./openai-models.js";
export {
	buildOpenAIModelsUrl,
	fetchOpenAIModelIds,
	parseOpenAIModelsResponse,
	resolveApiKeyValue,
} from "./openai-models.js";
export type { ModelTemplate } from "./templates.js";
export {
	MODEL_TEMPLATES,
	createDefaultModelConfig,
	createTemplateModelConfig,
	listModelTemplates,
	matchTemplate,
	templateLabel,
} from "./templates.js";

export default async function registerVendor(pi: ExtensionAPI): Promise<void> {
	registerVendorCommand(pi);
}

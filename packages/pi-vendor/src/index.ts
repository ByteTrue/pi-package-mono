import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerVendorCommand } from "./command.js";

export { registerVendorCommand } from "./command.js";

export type {
	ConfigErrorCode,
	ConfigIssue,
	ConfigIssueCode,
	ConfigRevision,
	ModelsSnapshot,
	PiOracle,
} from "./config-core.js";
export { commitModelsSnapshot, ConfigCoreError, readModelsSnapshot, validateModelsJson } from "./config-core.js";
export type {
	ConflictPolicy,
	ConfigValueClass,
	FieldDescriptor,
	ModelFieldKey,
	MutationError,
	MutationErrorCode,
	MutationResult,
	ProviderFieldKey,
} from "./config-document.js";
export { createCustomInput, createCustomSelect } from "./tui/custom-select.js";
export { customInput, customSelect, promptInput, promptJsonObject, selectValue, VENDOR_OVERLAY_OPTIONS } from "./tui/vendor-ui.js";
export type { SelectResult } from "./tui/vendor-ui.js";
export type { QuickUI } from "./tui/quick-adapter.js";
export { createProductionQuickUI, createScriptedQuickUI } from "./tui/quick-adapter.js";
export { showRootMenu, supportsInteractiveUI } from "./tui/quick-root.js";
export type { RootAction } from "./tui/quick-root.js";
export { runAddModelFlow } from "./tui/quick-add-model.js";
export type { AddModelResult } from "./tui/quick-add-model.js";
export {
	addModel,
	classifyConfigValue,
	createProvider,
	deleteModel,
	deleteProvider,
	listModelFields,
	listProviderFields,
	renameProvider,
	replaceModel,
} from "./config-document.js";
export type { ModelEnrichmentAmbiguous, ModelEnrichmentReady, ModelEnrichmentResult } from "./model-source/enrich.js";
export { enrichModelId } from "./model-source/enrich.js";
export { enrichModelForWeb, enrichModelForTui } from "./model-source/web-enrich.js";
export type {
	OfficialModelChoice,
	ThinkingLevel,
	WebChatTemplateKwarg,
	WebCompat,
	WebCost,
	WebCostTier,
	WebModelConfig,
} from "./model-source/web-model-dto.js";
export { toWebModelConfig } from "./model-source/web-model-dto.js";
export { searchOfficialModels } from "./model-source/catalog-search.js";
export { ModelSourceError } from "./model-source/model-source-error.js";
export type { ModelSourceErrorCode } from "./model-source/model-source-error.js";
export type { CommandRunner, CommandTrustPath, ConfigValueResolver, CredentialPath, ResolveResult } from "./model-source/config-resolver.js";
export { allCommandsTrusted, collectCommandPaths, createProductionCommandRunner, preflightCommandTrust, resolveConfigValue } from "./model-source/config-resolver.js";
export type { BoundedFetch, BoundedFetchResponse, DiscoverOptions } from "./model-source/bounded-discover.js";
export { discoverModelIds } from "./model-source/bounded-discover.js";
export type { ModelsJson, ModelOverrideConfig, ProviderConfig, ProviderDraft, ProviderModelConfig } from "./models-json.js";
export {
	cloneJson,
	createMinimalProviderConfig,
	createNewProviderDraft,
	createProviderDraft,
	getModelsJsonPath,
	readModelsJson,
	upsertProvider,
	writeModelsJson,
} from "./models-json.js";
export type { OfficialModelCandidate, OfficialModelsCatalog, OfficialModelConfig } from "./model-source/official-catalog.js";
export {
	collectOfficialCandidates,
	findOfficialCatalogPath,
	formatOfficialCandidate,
	loadOfficialCatalog,
	stripOfficialRoutingFields,
} from "./model-source/official-catalog.js";
export type { FetchLike, OpenAIModelsProviderDraft } from "./model-source/openai-models.js";
export {
	buildOpenAIModelsUrl,
	fetchOpenAIModelIds,
	parseOpenAIModelsResponse,
	resolveApiKeyValue,
} from "./model-source/openai-models.js";
export type { ModelTemplate } from "./model-source/templates.js";
export {
	MODEL_TEMPLATES,
	createDefaultModelConfig,
	createTemplateModelConfig,
	listModelTemplates,
	matchTemplate,
	templateLabel,
} from "./model-source/templates.js";

import { createSessionShutdownHandler } from "./web/server/session.js";
export { startVendorWebSession, openBrowser, getActiveSession, clearActiveSession, createSessionShutdownHandler } from "./web/server/session.js";
export type { VendorWebResult, VendorWebSession, WebSessionPhase, WebSessionState } from "./web/server/server.js";
export default async function registerVendor(pi: ExtensionAPI): Promise<void> {
	registerVendorCommand(pi);
	const onShutdown = createSessionShutdownHandler();
	pi.on("session_shutdown", onShutdown);
}

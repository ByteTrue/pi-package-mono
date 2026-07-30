import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { getModelsJsonPath, readModelsJson, type ModelsJson, type ProviderConfig } from "./models-json.js";
import { discoverModelIds } from "./model-source/bounded-discover.js";
import { searchOfficialModels } from "./model-source/catalog-search.js";
import { createProductionCommandRunner } from "./model-source/config-resolver.js";

const CATALOG_LIMIT_MAX = 100;

export type VendorToolDependencies = {
	searchCatalog: typeof searchOfficialModels;
	discover: typeof discoverModelIds;
	readModels: () => ModelsJson;
	runCommand: ReturnType<typeof createProductionCommandRunner>;
};

const productionDependencies: VendorToolDependencies = {
	searchCatalog: searchOfficialModels,
	discover: discoverModelIds,
	readModels: readModelsJson,
	runCommand: createProductionCommandRunner(),
};

function textResult(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value };
}

function redactApiKeys(message: string, models: ModelsJson): string {
	let redacted = message;
	for (const provider of Object.values(models.providers ?? {})) {
		if (typeof provider.apiKey === "string" && provider.apiKey.length > 0) {
			redacted = redacted.split(provider.apiKey).join("[REDACTED]");
		}
	}
	return redacted;
}

function requireDiscoverableProvider(models: ModelsJson, providerKey: string): ProviderConfig & { baseUrl: string } {
	const provider = models.providers?.[providerKey];
	if (!provider) throw new Error(`Provider "${providerKey}" was not found`);
	if (typeof provider.baseUrl !== "string" || provider.baseUrl.trim() === "") {
		throw new Error(`Provider "${providerKey}" has no baseUrl`);
	}
	return provider as ProviderConfig & { baseUrl: string };
}

export function registerVendorTools(
	pi: ExtensionAPI,
	dependencies: VendorToolDependencies = productionDependencies,
): void {
	pi.registerTool({
		name: "vendor_catalog_search",
		label: "Vendor Catalog Search",
		description: "Search the active Pi model catalog and return closed, credential-free model templates. Results are read-only and capped at 100 entries.",
		promptSnippet: "Search active Pi's official model catalog for model templates",
		parameters: Type.Object({
			query: Type.String({ description: "Model id or name fragment", maxLength: 512 }),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: CATALOG_LIMIT_MAX, default: 50 })),
		}),
		async execute(_id, params) {
			const results = await dependencies.searchCatalog(params.query, params.limit);
			return textResult({ query: params.query, count: results.length, results });
		},
	});

	pi.registerTool({
		name: "vendor_validate",
		label: "Vendor Validate",
		description: "Ask the running Pi model registry to reload models.json and report whether Pi accepts it. Does not modify models.json.",
		promptSnippet: "Validate the current models.json with the running Pi registry",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			let models: ModelsJson = { providers: {} };
			try {
				models = dependencies.readModels();
				await ctx.modelRegistry.refresh();
				const error = ctx.modelRegistry.getError();
				return textResult(error
					? { valid: false, error: redactApiKeys(error, models) }
					: { valid: true, path: getModelsJsonPath() });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult({ valid: false, error: redactApiKeys(message, models) });
			}
		},
	});

	pi.registerTool({
		name: "vendor_discover",
		label: "Vendor Discover",
		description: "Read one configured provider and safely request its OpenAI-compatible /models endpoint. Returns model ids only; never returns credentials.",
		promptSnippet: "Discover model ids from a configured provider's /models endpoint",
		parameters: Type.Object({
			providerKey: Type.String({ description: "Exact provider key in models.json", minLength: 1 }),
		}),
		async execute(_id, params, signal) {
			const models = dependencies.readModels();
			const provider = requireDiscoverableProvider(models, params.providerKey);
			const ids = await dependencies.discover(
				{ baseUrl: provider.baseUrl, apiKey: provider.apiKey, headers: provider.headers },
				{
					initialProvider: { apiKey: provider.apiKey, headers: provider.headers },
					signal,
					runCommand: dependencies.runCommand,
				},
			);
			return textResult({ providerKey: params.providerKey, count: ids.length, modelIds: ids });
		},
	});
}

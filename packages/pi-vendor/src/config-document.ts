/**
 * Pure provider/model document mutations used by the /vendor quick flows.
 */

import type { ModelsJson, ProviderConfig, ProviderModelConfig } from "./models-json.js";

export type ConflictPolicy = "reject" | "overwrite-confirmed";
export type MutationErrorCode =
	| "invalid_provider_key"
	| "invalid_model_id"
	| "provider_not_found"
	| "model_not_found"
	| "provider_exists"
	| "model_exists";
export type MutationError = { code: MutationErrorCode; path: string; message: string };
export type MutationResult<T> = { ok: true; value: T } | { ok: false; error: MutationError };

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function error(code: MutationErrorCode, path: string): MutationResult<never> {
	return { ok: false, error: { code, path, message: code.replaceAll("_", " ") } };
}

function pointer(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function providerKey(value: string): string | undefined {
	return value.trim() || undefined;
}

function modelId(value: string): string | undefined {
	return value.trim() || undefined;
}

function clonedProviders(models: ModelsJson): Record<string, ProviderConfig> {
	return cloneJson(models.providers ?? {});
}

function hasProvider(providers: Record<string, ProviderConfig>, key: string): boolean {
	return Object.hasOwn(providers, key);
}

function setProvider(providers: Record<string, ProviderConfig>, key: string, config: ProviderConfig): void {
	Object.defineProperty(providers, key, { configurable: true, enumerable: true, value: config, writable: true });
}

export function createProvider(models: ModelsJson, key: string, config: ProviderConfig): MutationResult<ModelsJson> {
	const nextKey = providerKey(key);
	if (!nextKey) return error("invalid_provider_key", "/providers");
	const providers = clonedProviders(models);
	if (hasProvider(providers, nextKey)) return error("provider_exists", `/providers/${pointer(nextKey)}`);
	setProvider(providers, nextKey, cloneJson(config));
	return { ok: true, value: { ...cloneJson(models), providers } };
}

function providerModels(
	models: ModelsJson,
	provider: string,
): { document: ModelsJson; providers: Record<string, ProviderConfig>; config: ProviderConfig; models: ProviderModelConfig[] } | MutationResult<never> {
	const key = providerKey(provider);
	if (!key) return error("invalid_provider_key", "/providers");
	const document = cloneJson(models);
	const providers = clonedProviders(models);
	if (!hasProvider(providers, key)) return error("provider_not_found", `/providers/${pointer(key)}`);
	const config = providers[key]!;
	return { document, providers, config, models: Array.isArray(config.models) ? config.models : [] };
}

export function addModel(models: ModelsJson, provider: string, model: ProviderModelConfig): MutationResult<ModelsJson> {
	const id = modelId(model.id);
	if (!id) return error("invalid_model_id", "/providers/models");
	const state = providerModels(models, provider);
	if ("ok" in state) return state;
	if (state.models.some((entry) => entry.id === id)) return error("model_exists", "/providers/models");
	state.config.models = [...state.models, { ...cloneJson(model), id }];
	return { ok: true, value: { ...state.document, providers: state.providers } };
}

export function replaceModel(
	models: ModelsJson,
	provider: string,
	previousId: string,
	model: ProviderModelConfig,
	options: { conflict?: ConflictPolicy } = {},
): MutationResult<ModelsJson> {
	const source = modelId(previousId);
	const target = modelId(model.id);
	if (!source || !target) return error("invalid_model_id", "/providers/models");
	const state = providerModels(models, provider);
	if ("ok" in state) return state;
	const sourceIndex = state.models.findIndex((entry) => entry.id === source);
	if (sourceIndex < 0) return error("model_not_found", "/providers/models");
	const targetIndex = state.models.findIndex((entry) => entry.id === target);
	if (targetIndex >= 0 && targetIndex !== sourceIndex && options.conflict !== "overwrite-confirmed") {
		return error("model_exists", "/providers/models");
	}
	const replacement = { ...cloneJson(model), id: target };
	const insertIndex = targetIndex >= 0 && targetIndex !== sourceIndex ? Math.min(sourceIndex, targetIndex) : sourceIndex;
	state.config.models = state.models.flatMap((entry, index) => {
		if (index === insertIndex) return [replacement];
		return index === sourceIndex || index === targetIndex ? [] : [entry];
	});
	return { ok: true, value: { ...state.document, providers: state.providers } };
}

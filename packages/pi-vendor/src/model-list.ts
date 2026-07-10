import type { ProviderConfig, ProviderModelConfig } from "./models-json.js";

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export function modelList(config: ProviderConfig): ProviderModelConfig[] {
	return Array.isArray(config.models) ? config.models.map((model) => cloneJson(model)) : [];
}

export function upsertModel(models: ProviderModelConfig[], model: ProviderModelConfig): ProviderModelConfig[] {
	const next = models.map((entry) => cloneJson(entry));
	const index = next.findIndex((entry) => entry.id === model.id);
	if (index >= 0) {
		next[index] = cloneJson(model);
		return next;
	}
	next.push(cloneJson(model));
	return next;
}

export function removeModelAtIndex(models: ProviderModelConfig[], index: number): ProviderModelConfig[] {
	return models.filter((_, current) => current !== index).map((entry) => cloneJson(entry));
}

export function replaceModelAtIndex(
	models: ProviderModelConfig[],
	index: number,
	model: ProviderModelConfig,
): ProviderModelConfig[] {
	const next = removeModelAtIndex(models, index);
	return upsertModel(next, model);
}

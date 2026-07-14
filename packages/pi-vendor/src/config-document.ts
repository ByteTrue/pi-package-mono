import type { ModelsJson, ProviderConfig, ProviderModelConfig } from "./models-json.js";

export type {
	ConflictPolicy,
	MutationErrorCode,
	MutationError,
	MutationResult,
} from "./config-mutations.js";

export {
	createProvider,
	renameProvider,
	deleteProvider,
	addModel,
	replaceModel,
	deleteModel,
	isUnderProviderPath,
	categorizeSecretSlot,
} from "./config-mutations.js";

export type ConfigValueClass = "literal" | "env-reference" | "command";

export type FieldDescriptor<K extends string> = {
	key: K;
	label: string;
	kind: "text" | "secret-text" | "boolean" | "json";
	common: boolean;
	required: boolean;
};

export type ProviderFieldKey = "name" | "baseUrl" | "api" | "apiKey" | "headers" | "authHeader" | "compat" | "modelOverrides";
export type ModelFieldKey =
	| "id"
	| "name"
	| "api"
	| "baseUrl"
	| "reasoning"
	| "thinkingLevelMap"
	| "input"
	| "cost"
	| "contextWindow"
	| "maxTokens"
	| "headers"
	| "compat";

const providerFields: readonly FieldDescriptor<ProviderFieldKey>[] = [
	{ key: "name", label: "Name", kind: "text", common: false, required: false },
	{ key: "baseUrl", label: "Base URL", kind: "text", common: true, required: false },
	{ key: "api", label: "API", kind: "text", common: true, required: false },
	{ key: "apiKey", label: "API key", kind: "secret-text", common: true, required: false },
	{ key: "headers", label: "Headers", kind: "json", common: false, required: false },
	{ key: "authHeader", label: "Auth header", kind: "boolean", common: false, required: false },
	{ key: "compat", label: "Compatibility", kind: "json", common: false, required: false },
	{ key: "modelOverrides", label: "Model overrides", kind: "json", common: false, required: false },
];

const modelFields: readonly FieldDescriptor<ModelFieldKey>[] = [
	{ key: "id", label: "ID", kind: "text", common: true, required: true },
	{ key: "name", label: "Name", kind: "text", common: false, required: false },
	{ key: "api", label: "API", kind: "text", common: false, required: false },
	{ key: "baseUrl", label: "Base URL", kind: "text", common: false, required: false },
	{ key: "reasoning", label: "Reasoning", kind: "boolean", common: false, required: false },
	{ key: "thinkingLevelMap", label: "Thinking level map", kind: "json", common: false, required: false },
	{ key: "input", label: "Input", kind: "json", common: false, required: false },
	{ key: "cost", label: "Cost", kind: "json", common: false, required: false },
	{ key: "contextWindow", label: "Context window", kind: "text", common: false, required: false },
	{ key: "maxTokens", label: "Max tokens", kind: "text", common: false, required: false },
	{ key: "headers", label: "Headers", kind: "json", common: false, required: false },
	{ key: "compat", label: "Compatibility", kind: "json", common: false, required: false },
];

export function listProviderFields(): readonly FieldDescriptor<ProviderFieldKey>[] {
	return providerFields;
}

export function listModelFields(): readonly FieldDescriptor<ModelFieldKey>[] {
	return modelFields;
}

export function classifyConfigValue(value: string): ConfigValueClass {
	if (value.startsWith("!")) return "command";
	for (let index = 0; index < value.length; index += 1) {
		if (value[index] !== "$") continue;
		const next = value[index + 1];
		if (next === "$" || next === "!") {
			index += 1;
			continue;
		}
		if (next === "{" ? /^\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value.slice(index + 1)) : /^[A-Za-z_]/.test(next ?? "")) {
			return "env-reference";
		}
	}
	return "literal";
}

export type { ModelsJson, ProviderConfig, ProviderModelConfig };

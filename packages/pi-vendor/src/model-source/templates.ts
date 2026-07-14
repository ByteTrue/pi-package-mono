import type { ProviderModelConfig } from "../models-json.js";

export type ModelTemplate = {
	id?: string;
	prefix?: string;
	name?: string;
	reasoning?: boolean;
	input?: Array<"text" | "image">;
	contextWindow?: number;
	maxTokens?: number;
	cost?: Record<string, number>;
	compat?: Record<string, unknown>;
	thinkingLevelMap?: Record<string, string | null>;
};

export const MODEL_TEMPLATES: readonly ModelTemplate[] = [
	{
		id: "gpt-4o",
		name: "GPT-4o",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 128000,
		maxTokens: 16384,
		compat: {
			supportsReasoningEffort: true,
		},
	},
	{
		prefix: "gpt-4",
		name: "GPT-4 family",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		prefix: "claude-3.7",
		name: "Claude 3.7 family",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		prefix: "gemini-2.5",
		name: "Gemini 2.5 family",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 1000000,
		maxTokens: 8192,
	},
	{
		prefix: "deepseek-v3",
		name: "DeepSeek V3 family",
		reasoning: true,
		input: ["text"],
		contextWindow: 128000,
		maxTokens: 16384,
	},
] as const;

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export function listModelTemplates(): ModelTemplate[] {
	return MODEL_TEMPLATES.map((template) => cloneJson(template));
}

export function templateLabel(template: ModelTemplate): string {
	if (template.id) {
		return template.name && template.name !== template.id ? `${template.id} - ${template.name}` : template.id;
	}
	if (template.prefix) {
		return template.name ? `${template.prefix}* - ${template.name}` : `${template.prefix}*`;
	}
	return template.name ?? "template";
}

export function matchTemplate(modelId: string, templates: readonly ModelTemplate[] = MODEL_TEMPLATES): ModelTemplate | undefined {
	const exact = templates.find((template) => template.id === modelId);
	if (exact) return exact;

	let best: ModelTemplate | undefined;
	let bestLength = -1;
	for (const template of templates) {
		if (!template.prefix) continue;
		if (!modelId.startsWith(template.prefix)) continue;
		if (template.prefix.length > bestLength) {
			best = template;
			bestLength = template.prefix.length;
		}
	}
	return best;
}

export function createTemplateModelConfig(modelId: string, template: ModelTemplate): ProviderModelConfig {
	return {
		id: modelId,
		name: template.name?.trim() || modelId,
		reasoning: template.reasoning ?? false,
		input: template.input ? [...template.input] : ["text"],
		contextWindow: template.contextWindow ?? 128000,
		maxTokens: template.maxTokens ?? 16384,
		...(template.cost ? { cost: cloneJson(template.cost) } : {}),
		...(template.compat ? { compat: cloneJson(template.compat) } : {}),
		...(template.thinkingLevelMap ? { thinkingLevelMap: cloneJson(template.thinkingLevelMap) } : {}),
	};
}

export function createDefaultModelConfig(modelId: string): ProviderModelConfig {
	return {
		id: modelId,
		name: modelId,
		reasoning: false,
		input: ["text"],
		contextWindow: 128000,
		maxTokens: 16384,
	};
}

// CatalogModelTemplate: closed safe DTO for catalog and AI-tool consumption.
// Never includes routing fields, credentials, or unknown compat fields.

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type CatalogChatTemplateKwarg =
	| string
	| number
	| boolean
	| null
	| { $var: "thinking.enabled" | "thinking.effort"; omitWhenOff?: boolean };

export type CatalogCostTier = {
	inputTokensAbove: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

export type CatalogCost = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	tiers?: CatalogCostTier[];
};

export type CatalogCompat = {
	supportsStore?: boolean;
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
	supportsUsageInStreaming?: boolean;
	maxTokensField?: "max_completion_tokens" | "max_tokens";
	requiresToolResultName?: boolean;
	requiresAssistantAfterToolResult?: boolean;
	requiresThinkingAsText?: boolean;
	requiresReasoningContentOnAssistantMessages?: boolean;
	thinkingFormat?:
		| "openai"
		| "openrouter"
		| "together"
		| "deepseek"
		| "zai"
		| "qwen"
		| "chat-template"
		| "qwen-chat-template"
		| "string-thinking"
		| "ant-ling";
	chatTemplateKwargs?: Record<string, CatalogChatTemplateKwarg>;
	cacheControlFormat?: "anthropic";
	supportsStrictMode?: boolean;
	supportsStrictTools?: boolean;
	supportsOpenAIGrammarTools?: boolean;
	supportsToolSearch?: boolean;
	supportsExplicitPromptCacheMode?: boolean;
	deferredToolsMode?: "kimi";
	sessionAffinityFormat?: "openai" | "openai-nosession" | "openrouter";
	supportsLongCacheRetention?: boolean;
	sendSessionIdHeader?: boolean;
	supportsEagerToolInputStreaming?: boolean;
	sendSessionAffinityHeaders?: boolean;
	supportsCacheControlOnTools?: boolean;
	forceAdaptiveThinking?: boolean;
	// Characterized-safe fields present in current Pi catalog:
	zaiToolStream?: boolean;
	supportsTemperature?: boolean;
	allowEmptySignature?: boolean;
};

export type CatalogModelTemplate = {
	id: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
	input?: Array<"text" | "image">;
	cost?: CatalogCost;
	contextWindow?: number;
	maxTokens?: number;
	compat?: CatalogCompat;
};

export type OfficialModelChoice = {
	provider: string;
	modelId: string;
	model: CatalogModelTemplate;
};

// -- allowed key sets for recursive reconstruction --

const MODEL_ALLOWED: ReadonlySet<string> = new Set([
	"id", "name", "api", "reasoning", "thinkingLevelMap",
	"input", "cost", "contextWindow", "maxTokens", "compat",
]);

const MODEL_ROUTING_FIELDS: ReadonlySet<string> = new Set([
	"provider", "baseUrl", "headers", "apiKey", "authHeader",
]);

const COST_ALLOWED: ReadonlySet<string> = new Set([
	"input", "output", "cacheRead", "cacheWrite", "tiers",
]);

const TIER_ALLOWED: ReadonlySet<string> = new Set([
	"inputTokensAbove", "input", "output", "cacheRead", "cacheWrite",
]);

const COMPAT_ALLOWED: ReadonlySet<string> = new Set([
	"supportsStore",
	"supportsDeveloperRole",
	"supportsReasoningEffort",
	"supportsUsageInStreaming",
	"maxTokensField",
	"requiresToolResultName",
	"requiresAssistantAfterToolResult",
	"requiresThinkingAsText",
	"requiresReasoningContentOnAssistantMessages",
	"thinkingFormat",
	"chatTemplateKwargs",
	"cacheControlFormat",
	"supportsStrictMode",
	"supportsStrictTools",
	"supportsOpenAIGrammarTools",
	"supportsToolSearch",
	"supportsExplicitPromptCacheMode",
	"deferredToolsMode",
	"sessionAffinityFormat",
	"supportsLongCacheRetention",
	"sendSessionIdHeader",
	"supportsEagerToolInputStreaming",
	"sendSessionAffinityHeaders",
	"supportsCacheControlOnTools",
	"forceAdaptiveThinking",
	"zaiToolStream",
	"supportsTemperature",
	"allowEmptySignature",
]);

const THINKING_LEVELS: ReadonlySet<string> = new Set([
	"off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

const VALID_MAX_TOKENS_FIELDS: ReadonlySet<string> = new Set([
	"max_completion_tokens", "max_tokens",
]);

const VALID_THINKING_FORMATS: ReadonlySet<string> = new Set([
	"openai", "openrouter", "together", "deepseek", "zai", "qwen",
	"chat-template", "qwen-chat-template", "string-thinking", "ant-ling",
]);

const VALID_SESSION_AFFINITY_FORMATS: ReadonlySet<string> = new Set([
	"openai", "openai-nosession", "openrouter",
]);

export class CatalogShapeError extends Error {
	constructor(readonly field: string) {
		super(`Unsupported official catalog field: ${field}`);
		this.name = "CatalogShapeError";
	}
}

function assertAllowedKeys(raw: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
	for (const key of Object.keys(raw)) {
		if (!allowed.has(key)) throw new CatalogShapeError(`${path}.${key}`);
	}
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeBoolean(v: unknown): boolean | undefined {
	return typeof v === "boolean" ? v : undefined;
}

function safeNumber(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function safeString(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

// --- CatalogCostTier mapper ---

function toCatalogCostTier(raw: Record<string, unknown>): CatalogCostTier | undefined {
	assertAllowedKeys(raw, TIER_ALLOWED, "cost.tiers[]");
	const inputTokensAbove = safeNumber(raw.inputTokensAbove);
	const input = safeNumber(raw.input);
	const output = safeNumber(raw.output);
	const cacheRead = safeNumber(raw.cacheRead);
	const cacheWrite = safeNumber(raw.cacheWrite);
	if (inputTokensAbove == null || input == null || output == null || cacheRead == null || cacheWrite == null) return undefined;
	return { inputTokensAbove, input, output, cacheRead, cacheWrite };
}

function toCatalogCostTiers(raw: unknown[]): CatalogCostTier[] | undefined {
	const tiers: CatalogCostTier[] = [];
	for (const item of raw) {
		if (!isRecord(item)) throw new CatalogShapeError("cost.tiers[]");
		const tier = toCatalogCostTier(item);
		if (tier) tiers.push(tier);
	}
	return tiers.length > 0 ? tiers : undefined;
}

// --- CatalogCost mapper ---

function toCatalogCost(raw: Record<string, unknown>): CatalogCost | undefined {
	assertAllowedKeys(raw, COST_ALLOWED, "cost");
	const input = safeNumber(raw.input);
	const output = safeNumber(raw.output);
	const cacheRead = safeNumber(raw.cacheRead);
	const cacheWrite = safeNumber(raw.cacheWrite);
	if (input == null || output == null || cacheRead == null || cacheWrite == null) return undefined;
	const cost: CatalogCost = { input, output, cacheRead, cacheWrite };
	if (Array.isArray(raw.tiers)) {
		const tiers = toCatalogCostTiers(raw.tiers);
		if (tiers) cost.tiers = tiers;
	}
	return cost;
}

// --- chatTemplateKwargs mapper ---

function isChatTemplateKwarg(v: unknown): v is CatalogChatTemplateKwarg {
	if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) return true;
	if (!isRecord(v)) return false;
	const keys = Object.keys(v);
	if (keys.length < 1 || keys.length > 2) return false;
	if (v.$var !== "thinking.enabled" && v.$var !== "thinking.effort") return false;
	for (const k of keys) {
		if (k !== "$var" && k !== "omitWhenOff") return false;
		if (k === "omitWhenOff" && typeof v.omitWhenOff !== "boolean") return false;
	}
	return true;
}

function toChatTemplateKwargs(raw: Record<string, unknown>): Record<string, CatalogChatTemplateKwarg> | undefined {
	const out: Record<string, CatalogChatTemplateKwarg> = {};
	let hasAny = false;
	for (const [k, v] of Object.entries(raw)) {
		if (!isChatTemplateKwarg(v)) throw new CatalogShapeError(`compat.chatTemplateKwargs.${k}`);
		out[k] = v;
		hasAny = true;
	}
	return hasAny ? out : undefined;
}

// --- CatalogCompat mapper ---

function toCatalogCompat(raw: Record<string, unknown>): CatalogCompat | undefined {
	assertAllowedKeys(raw, COMPAT_ALLOWED, "compat");
	const compat: CatalogCompat = {};
	let hasAny = false;

	for (const [k, v] of Object.entries(raw)) {
		switch (k) {
			case "maxTokensField":
				if (typeof v === "string" && VALID_MAX_TOKENS_FIELDS.has(v)) { compat.maxTokensField = v as CatalogCompat["maxTokensField"]; hasAny = true; }
				break;
			case "thinkingFormat":
				if (typeof v === "string" && VALID_THINKING_FORMATS.has(v)) { compat.thinkingFormat = v as CatalogCompat["thinkingFormat"]; hasAny = true; }
				break;
			case "sessionAffinityFormat":
				if (typeof v === "string" && VALID_SESSION_AFFINITY_FORMATS.has(v)) { compat.sessionAffinityFormat = v as CatalogCompat["sessionAffinityFormat"]; hasAny = true; }
				break;
			case "deferredToolsMode":
				if (v === "kimi") { compat.deferredToolsMode = v; hasAny = true; }
				break;
			case "chatTemplateKwargs": {
				if (!isRecord(v)) break;
				const kwargs = toChatTemplateKwargs(v);
				if (kwargs) { compat.chatTemplateKwargs = kwargs; hasAny = true; }
				break;
			}
			case "cacheControlFormat":
				if (v === "anthropic") { compat.cacheControlFormat = v; hasAny = true; }
				break;
			default: {
				// all remaining are boolean-typed
				const b = safeBoolean(v);
				if (b !== undefined) { (compat as Record<string, boolean>)[k] = b; hasAny = true; }
				break;
			}
		}
	}
	return hasAny ? compat : undefined;
}

// --- thinkingLevelMap mapper ---

function toThinkingLevelMap(raw: Record<string, unknown>): Partial<Record<ThinkingLevel, string | null>> | undefined {
	const map: Partial<Record<ThinkingLevel, string | null>> = {};
	let hasAny = false;
	for (const [k, v] of Object.entries(raw)) {
		if (!THINKING_LEVELS.has(k)) throw new CatalogShapeError(`thinkingLevelMap.${k}`);
		if (v !== null && typeof v !== "string") throw new CatalogShapeError(`thinkingLevelMap.${k}`);
		map[k as ThinkingLevel] = v;
		hasAny = true;
	}
	return hasAny ? map : undefined;
}

// --- top-level CatalogModelTemplate mapper ---

export function toCatalogModelTemplate(raw: Record<string, unknown>): CatalogModelTemplate | undefined {
	assertAllowedKeys(raw, new Set([...MODEL_ALLOWED, ...MODEL_ROUTING_FIELDS]), "model");
	const id = safeString(raw.id);
	if (!id) return undefined;

	const config: CatalogModelTemplate = { id };

	const name = safeString(raw.name);
	if (name !== undefined) config.name = name;

	const api = safeString(raw.api);
	if (api !== undefined) config.api = api;

	const reasoning = safeBoolean(raw.reasoning);
	if (reasoning !== undefined) config.reasoning = reasoning;

	if (isRecord(raw.thinkingLevelMap)) {
		const tlm = toThinkingLevelMap(raw.thinkingLevelMap);
		if (tlm) config.thinkingLevelMap = tlm;
	}

	if (Array.isArray(raw.input)) {
		const input: Array<"text" | "image"> = [];
		for (const item of raw.input) {
			if (item !== "text" && item !== "image") throw new CatalogShapeError("model.input[]");
			input.push(item);
		}
		if (input.length > 0) config.input = input;
	}

	if (isRecord(raw.cost)) {
		const cost = toCatalogCost(raw.cost);
		if (cost) config.cost = cost;
	}

	const contextWindow = safeNumber(raw.contextWindow);
	if (contextWindow !== undefined) config.contextWindow = contextWindow;

	const maxTokens = safeNumber(raw.maxTokens);
	if (maxTokens !== undefined) config.maxTokens = maxTokens;

	if (isRecord(raw.compat)) {
		const compat = toCatalogCompat(raw.compat);
		if (compat) config.compat = compat;
	}

	return config;
}

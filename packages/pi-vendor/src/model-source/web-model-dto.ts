// WebModelConfig: closed safe DTO for browser consumption.
// Never includes routing fields, credentials, or unknown compat fields.

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type WebChatTemplateKwarg =
	| string
	| number
	| boolean
	| null
	| { $var: "thinking.enabled" | "thinking.effort"; omitWhenOff?: boolean };

export type WebCostTier = {
	inputTokensAbove: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

export type WebCost = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	tiers?: WebCostTier[];
};

export type WebCompat = {
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
	chatTemplateKwargs?: Record<string, WebChatTemplateKwarg>;
	cacheControlFormat?: "anthropic";
	supportsStrictMode?: boolean;
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

export type WebModelConfig = {
	id: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
	input?: Array<"text" | "image">;
	cost?: WebCost;
	contextWindow?: number;
	maxTokens?: number;
	compat?: WebCompat;
};

export type OfficialModelChoice = {
	provider: string;
	modelId: string;
	model: WebModelConfig;
};

export type WebModelEnrichmentResult =
	| { kind: "ready"; source: "official" | "template" | "default"; model: WebModelConfig; warning?: string }
	| { kind: "official-candidates"; modelId: string; candidates: OfficialModelChoice[] };

// -- allowed key sets for recursive reconstruction --

const MODEL_ALLOWED: ReadonlySet<string> = new Set([
	"id", "name", "api", "reasoning", "thinkingLevelMap",
	"input", "cost", "contextWindow", "maxTokens", "compat",
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

// --- WebCostTier mapper ---

function toWebCostTier(raw: Record<string, unknown>): WebCostTier | undefined {
	const inputTokensAbove = safeNumber(raw.inputTokensAbove);
	const input = safeNumber(raw.input);
	const output = safeNumber(raw.output);
	const cacheRead = safeNumber(raw.cacheRead);
	const cacheWrite = safeNumber(raw.cacheWrite);
	if (inputTokensAbove == null || input == null || output == null || cacheRead == null || cacheWrite == null) return undefined;
	return { inputTokensAbove, input, output, cacheRead, cacheWrite };
}

function toWebCostTiers(raw: unknown[]): WebCostTier[] | undefined {
	const tiers: WebCostTier[] = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		const tier = toWebCostTier(item);
		if (tier) tiers.push(tier);
	}
	return tiers.length > 0 ? tiers : undefined;
}

// --- WebCost mapper ---

function toWebCost(raw: Record<string, unknown>): WebCost | undefined {
	const input = safeNumber(raw.input);
	const output = safeNumber(raw.output);
	const cacheRead = safeNumber(raw.cacheRead);
	const cacheWrite = safeNumber(raw.cacheWrite);
	if (input == null || output == null || cacheRead == null || cacheWrite == null) return undefined;
	const cost: WebCost = { input, output, cacheRead, cacheWrite };
	if (Array.isArray(raw.tiers)) {
		const tiers = toWebCostTiers(raw.tiers);
		if (tiers) cost.tiers = tiers;
	}
	return cost;
}

// --- chatTemplateKwargs mapper ---

function isChatTemplateKwarg(v: unknown): v is WebChatTemplateKwarg {
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

function toChatTemplateKwargs(raw: Record<string, unknown>): Record<string, WebChatTemplateKwarg> | undefined {
	const out: Record<string, WebChatTemplateKwarg> = {};
	let hasAny = false;
	for (const [k, v] of Object.entries(raw)) {
		if (isChatTemplateKwarg(v)) {
			out[k] = v;
			hasAny = true;
		}
	}
	return hasAny ? out : undefined;
}

// --- WebCompat mapper ---

function toWebCompat(raw: Record<string, unknown>): WebCompat | undefined {
	const compat: WebCompat = {};
	let hasAny = false;

	for (const [k, v] of Object.entries(raw)) {
		if (!COMPAT_ALLOWED.has(k)) continue;
		switch (k) {
			case "maxTokensField":
				if (typeof v === "string" && VALID_MAX_TOKENS_FIELDS.has(v)) { compat.maxTokensField = v as WebCompat["maxTokensField"]; hasAny = true; }
				break;
			case "thinkingFormat":
				if (typeof v === "string" && VALID_THINKING_FORMATS.has(v)) { compat.thinkingFormat = v as WebCompat["thinkingFormat"]; hasAny = true; }
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
		if (!THINKING_LEVELS.has(k)) continue;
		if (v === null || typeof v === "string") {
			map[k as ThinkingLevel] = v;
			hasAny = true;
		}
	}
	return hasAny ? map : undefined;
}

// --- top-level WebModelConfig mapper ---

export function toWebModelConfig(raw: Record<string, unknown>): WebModelConfig | undefined {
	const id = safeString(raw.id);
	if (!id) return undefined;

	const config: WebModelConfig = { id };

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
			if (item === "text" || item === "image") input.push(item);
		}
		if (input.length > 0) config.input = input;
	}

	if (isRecord(raw.cost)) {
		const cost = toWebCost(raw.cost);
		if (cost) config.cost = cost;
	}

	const contextWindow = safeNumber(raw.contextWindow);
	if (contextWindow !== undefined) config.contextWindow = contextWindow;

	const maxTokens = safeNumber(raw.maxTokens);
	if (maxTokens !== undefined) config.maxTokens = maxTokens;

	if (isRecord(raw.compat)) {
		const compat = toWebCompat(raw.compat);
		if (compat) config.compat = compat;
	}

	return config;
}

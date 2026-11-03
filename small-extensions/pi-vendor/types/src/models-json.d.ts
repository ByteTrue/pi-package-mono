export type ModelInput = "text" | "image";
export type ThinkingLevelKey = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingLevelMap = Record<string, string | null>;
/** Provider value sent for each Pi thinking level; `null` marks it unsupported. */
export type SamplingParamsByThinkingLevel = Partial<Record<ThinkingLevelKey, Record<string, unknown>>>;
/** `cost` for a `models` entry: Pi requires all four base prices. */
export type ModelCost = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tiers?: ModelCostTier[];
    [key: string]: unknown;
};
/** `cost` for a `modelOverrides` entry: any subset merges onto the model's cost. */
export type ModelCostOverride = Partial<ModelCost>;
export type ModelCostTier = {
    inputTokensAbove: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    [key: string]: unknown;
};
export type ModelImageResize = {
    maxWidth?: number;
    maxHeight?: number;
    /** Maximum base64-encoded payload size in bytes. */
    maxBytes?: number;
    jpegQuality?: number;
    [key: string]: unknown;
};
export type ModelInputLimits = {
    maxRequestBytes?: number;
    images?: {
        resize?: ModelImageResize;
        maxPerMessage?: number;
        maxPerRequest?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
};
/** Best-effort prompt cache lifetime in seconds per retention tier. */
export type ModelPromptCache = {
    short?: number;
    long?: number;
    [key: string]: unknown;
};
/** Metadata shared by `models` entries and `modelOverrides` entries. */
export type ModelMetadata = {
    name?: string;
    reasoning?: boolean;
    thinkingLevelMap?: ThinkingLevelMap;
    input?: ModelInput[];
    inputLimits?: ModelInputLimits;
    promptCache?: ModelPromptCache;
    contextWindow?: number;
    maxTokens?: number;
    samplingParams?: Record<string, unknown>;
    samplingParamsByThinkingLevel?: SamplingParamsByThinkingLevel;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
};
export type ProviderModelConfig = ModelMetadata & {
    id: string;
    api?: string;
    baseUrl?: string;
    cost?: ModelCost;
    [key: string]: unknown;
};
export type ModelOverrideConfig = ModelMetadata & {
    cost?: ModelCostOverride;
    [key: string]: unknown;
};
export type ProviderConfig = {
    name?: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    authHeader?: boolean;
    /** OAuth login flow; only `radius` exists, and it requires `baseUrl`. */
    oauth?: "radius";
    compat?: Record<string, unknown>;
    modelOverrides?: Record<string, ModelOverrideConfig>;
    models?: ProviderModelConfig[];
    [key: string]: unknown;
};
export type ModelsJson = {
    /** Editor validation hint; see MODELS_JSON_SCHEMA_URL in config-core.ts. */
    $schema?: string;
    providers?: Record<string, ProviderConfig>;
    [key: string]: unknown;
};
export declare function getModelsJsonPath(): string;

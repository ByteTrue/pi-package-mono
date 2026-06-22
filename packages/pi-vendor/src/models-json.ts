import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ProviderModelConfig = {
	id: string;
	name?: string;
	api?: string;
	baseUrl?: string;
	reasoning?: boolean;
	thinkingLevelMap?: Record<string, string | null>;
	input?: Array<"text" | "image">;
	cost?: Record<string, number>;
	contextWindow?: number;
	maxTokens?: number;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	[key: string]: unknown;
};

export type ProviderConfig = {
	name?: string;
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
	compat?: Record<string, unknown>;
	models?: ProviderModelConfig[];
	[key: string]: unknown;
};

export type ModelsJson = {
	providers?: Record<string, ProviderConfig>;
	[key: string]: unknown;
};

export type ProviderDraft = {
	key: string;
	originalKey: string;
	config: ProviderConfig;
};

export type ProviderUpsertOptions = {
	previousKey?: string;
};

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export function getModelsJsonPath(): string {
	const baseDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	return join(baseDir, "models.json");
}

export function createMinimalProviderConfig(): ProviderConfig {
	return {
		baseUrl: "",
		api: "openai-completions",
		apiKey: "$ENV_VAR",
		models: [],
	};
}

function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
	const next = cloneJson(config);
	next.models = Array.isArray(next.models) ? next.models.map((model) => cloneJson(model)) : [];
	return next;
}

export function createProviderDraft(key: string, config: ProviderConfig): ProviderDraft {
	return {
		key,
		originalKey: key,
		config: normalizeProviderConfig(config),
	};
}

export function createNewProviderDraft(key: string): ProviderDraft {
	return createProviderDraft(key, createMinimalProviderConfig());
}

export function readModelsJson(path = getModelsJsonPath()): ModelsJson {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
			return { providers: {} };
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read models.json at ${path}: ${message}`);
	}

	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`Invalid models.json at ${path}: expected a JSON object`);
	}

	const providers = (raw as ModelsJson).providers;
	if (providers !== undefined && (providers === null || typeof providers !== "object" || Array.isArray(providers))) {
		throw new Error(`Invalid models.json at ${path}: providers must be an object`);
	}

	return raw as ModelsJson;
}

export function writeModelsJson(models: ModelsJson, path = getModelsJsonPath()): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(models, null, 2)}\n`, "utf8");
}

export function upsertProvider(modelsJson: ModelsJson, draft: ProviderDraft, options: ProviderUpsertOptions = {}): ModelsJson {
	const providers = { ...(modelsJson.providers ?? {}) };
	if (options.previousKey && options.previousKey !== draft.key) {
		delete providers[options.previousKey];
	}
	providers[draft.key] = normalizeProviderConfig(draft.config);
	return {
		...modelsJson,
		providers,
	};
}

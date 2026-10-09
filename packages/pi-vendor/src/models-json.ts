// Type definitions for the agent-dir models.json document plus the one path
// helper every reader/writer shares. There is deliberately no read/write layer
// here: all persistence goes through config-core.ts, which owns the sha256
// optimistic-concurrency snapshot contract (audit BYTE-4 #10 removed the
// dead second write path from this module).

import { homedir } from "node:os";
import { join } from "node:path";

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

export type ModelOverrideConfig = {
	name?: string;
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
	modelOverrides?: Record<string, ModelOverrideConfig>;
	models?: ProviderModelConfig[];
	[key: string]: unknown;
};

export type ModelsJson = {
	providers?: Record<string, ProviderConfig>;
	[key: string]: unknown;
};

export function getModelsJsonPath(): string {
	const baseDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	return join(baseDir, "models.json");
}

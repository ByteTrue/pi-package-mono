/**
 * Self-contained config for ~/.pi/byte-pi-web/config.json.
 *
 * Zero external deps. Fail-soft: malformed JSON or a schema violation degrades
 * to `{}` so a broken config never crashes startup — the default Exa MCP free
 * provider keeps working with no config at all.
 *
 * Key resolution per provider (first wins):
 *   1. per-provider env var (e.g. TAVILY_API_KEY)
 *   2. apiKeys[name] in the config file
 *
 * Base URL resolution per provider (first wins):
 *   1. per-provider env var (e.g. SEARXNG_URL)
 *   2. baseUrls[name] in the config file
 *   3. provider's defaultBaseUrl from registry
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { DEFAULT_PROVIDER_NAME, findProviderMeta } from "./providers/registry.js";

export const WebConfigSchema = Type.Object(
	{
		provider: Type.Optional(Type.String()),
		apiKeys: Type.Optional(Type.Record(Type.String(), Type.String())),
		baseUrls: Type.Optional(Type.Record(Type.String(), Type.String())),
		// Explicit HTTP(S) proxy for all web fetches, e.g. "http://127.0.0.1:7890".
		// Needed because Node's fetch ignores proxy env vars, and TUN-mode proxies
		// often set no env var at all. Takes precedence over HTTP(S)_PROXY env.
		proxy: Type.Optional(Type.String()),
		// When the active search provider fails or returns nothing, automatically
		// try the other available providers. Default: true.
		autoFallback: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: true },
);

export type WebConfig = Static<typeof WebConfigSchema>;

export type WebConfigReadResult =
	| { status: "missing" | "valid"; config: WebConfig }
	| { status: "invalid"; error: string };

function configDir(): string {
	// Live under pi's own config dir (~/.pi), overridable via PI_CONFIG_DIR.
	const base = process.env.PI_CONFIG_DIR?.trim() || join(homedir(), ".pi");
	return join(base, "byte-pi-web");
}

const CONFIG_PATH = join(configDir(), "config.json");

export function getConfigPath(): string {
	return CONFIG_PATH;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function readConfigResult(): WebConfigReadResult {
	let text: string;
	try {
		text = readFileSync(CONFIG_PATH, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", config: {} as WebConfig };
		return { status: "invalid", error: `Could not read ${CONFIG_PATH}: ${errorMessage(error)}` };
	}

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { status: "invalid", error: `Could not parse ${CONFIG_PATH}: invalid JSON` };
	}
	if (!Value.Check(WebConfigSchema, raw)) {
		return { status: "invalid", error: `${CONFIG_PATH} does not match the expected config schema` };
	}
	return { status: "valid", config: raw as WebConfig };
}

export function readConfig(): WebConfig {
	const result = readConfigResult();
	return result.status === "invalid" ? ({} as WebConfig) : result.config;
}

export function writeConfig(config: WebConfig): boolean {
	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		const body = `${JSON.stringify(config, null, 2)}\n`;
		const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
		// mode 0o600: may contain API keys. Atomic rename avoids half-written JSON.
		writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
		renameSync(tmp, CONFIG_PATH);
		return true;
	} catch {
		return false;
	}
}

export function getActiveProviderName(config: WebConfig): string {
	return config.provider?.trim() || DEFAULT_PROVIDER_NAME;
}

// Resolve a provider's API key: env var first, then config. Keyless providers
// (Exa MCP free, Bing, SearXNG) return undefined and don't need one.
export function resolveApiKey(providerName: string, config: WebConfig): string | undefined {
	const meta = findProviderMeta(providerName);
	if (!meta) return undefined;
	const envKey = meta.envVar ? process.env[meta.envVar]?.trim() : undefined;
	if (envKey) return envKey;
	return config.apiKeys?.[providerName]?.trim() || undefined;
}

// Resolve a provider's base URL: env var first, then config, then default.
export function resolveBaseUrl(providerName: string, config: WebConfig): string | undefined {
	const meta = findProviderMeta(providerName);
	if (!meta) return undefined;
	const envUrl = meta.baseUrlEnvVar ? process.env[meta.baseUrlEnvVar]?.trim() : undefined;
	if (envUrl) return envUrl;
	return config.baseUrls?.[providerName]?.trim() || meta.defaultBaseUrl;
}

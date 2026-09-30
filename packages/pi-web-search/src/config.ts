/**
 * Self-contained config for <agent dir>/pi-pkg-cfg/pi-web-search/config.json.
 *
 * Where that is: \`$PI_PKG_CFG_DIR\` if set, else \`<agent dir>/pi-pkg-cfg\` where
 * \`<agent dir>\` = \`$PI_CODING_AGENT_DIR\` or \`~/.pi/agent\`.
 *
 * The location used to be \`($PI_CONFIG_DIR or ~/.pi)/byte-pi-web/config.json\`. That
 * older file is still read — and the whole of it is copied into the new location
 * the first time we look — but it is never written, never deleted, and never
 * moved, so downgrading to an older pi-web-search still finds its config. Once
 * the new file exists the older one stops mattering entirely.
 *
 * Zero external deps. Fail-soft: malformed JSON or a schema violation degrades
 * to \`{}\` so a broken config never crashes startup — the default Exa MCP free
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

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { DEFAULT_PROVIDER_NAME, findProviderMeta } from "./providers/registry.js";

export const WebConfigSchema = Type.Object(
	{
		providers: Type.Optional(Type.Array(Type.String())),
		apiKeys: Type.Optional(Type.Record(Type.String(), Type.String())),
		baseUrls: Type.Optional(Type.Record(Type.String(), Type.String())),
		// Explicit HTTP(S) proxy for all web fetches, e.g. "http://127.0.0.1:7890".
		// Needed because Node's fetch ignores proxy env vars, and TUN-mode proxies
		// often set no env var at all. Takes precedence over HTTP(S)_PROXY env.
		proxy: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

export type WebConfig = Static<typeof WebConfigSchema>;

export type WebConfigReadResult =
	| { status: "missing" | "valid"; config: WebConfig }
	| { status: "invalid"; error: string };

const PKG_CONFIG_DIRNAME = "pi-pkg-cfg";
const PKG_DIRNAME = "pi-web-search";
const PKG_FILENAME = "config.json";
const LEGACY_DIRNAME = "byte-pi-web";

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

function pkgConfigRoot(): string {
	return process.env.PI_PKG_CFG_DIR?.trim() || join(agentDir(), PKG_CONFIG_DIRNAME);
}

function newConfigPath(): string {
	return join(pkgConfigRoot(), PKG_DIRNAME, PKG_FILENAME);
}

// PI_CONFIG_DIR only locates the pre-migration file now; it no longer decides
// where writes go.
function legacyConfigPath(): string {
	const base = process.env.PI_CONFIG_DIR?.trim() || join(homedir(), ".pi");
	return join(base, LEGACY_DIRNAME, PKG_FILENAME);
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

export type WebConfigLocation = { path: string; legacy: boolean };

/**
 * Where this run reads from. The first look after an upgrade copies the whole
 * older file into the new location (one atomic write, same bytes); if that copy
 * fails the older path stays in charge, flagged legacy so callers can say so.
 */
export function configLocation(): WebConfigLocation {
	const target = newConfigPath();
	if (isFile(target)) return { path: target, legacy: false };
	const legacy = legacyConfigPath();
	if (!isFile(legacy)) return { path: target, legacy: false };
	try {
		const body = readFileSync(legacy);
		// Never carry a broken file forward — it is reported as invalid in place.
		JSON.parse(body.toString("utf8"));
		mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
		const tmp = `${target}.${process.pid}.tmp`;
		writeFileSync(tmp, body, { mode: 0o600 });
		renameSync(tmp, target);
		return { path: target, legacy: false };
	} catch {
		return { path: legacy, legacy: true };
	}
}

export function getConfigPath(): string {
	return configLocation().path;
}

export function isLegacyConfigPath(): boolean {
	return configLocation().legacy;
}

// For status lines: says out loud when the older file is still the live one.
export function describeConfigPath(): string {
	const { path, legacy } = configLocation();
	return legacy ? `${path} (legacy (read-only fallback))` : path;
}

// Writes never touch the legacy path, so save failures must name this one.
export function getWritableConfigPath(): string {
	return newConfigPath();
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function readConfigResult(): WebConfigReadResult {
	const { path } = configLocation();
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", config: {} as WebConfig };
		return { status: "invalid", error: `Could not read ${path}: ${errorMessage(error)}` };
	}

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { status: "invalid", error: `Could not parse ${path}: invalid JSON` };
	}
	if (!Value.Check(WebConfigSchema, raw)) {
		return { status: "invalid", error: `${path} does not match the expected config schema` };
	}
	return { status: "valid", config: raw as WebConfig };
}

export function readConfig(): WebConfig {
	const result = readConfigResult();
	return result.status === "invalid" ? ({} as WebConfig) : result.config;
}

// Always writes the new location: the legacy path is read-only by design.
export function writeConfig(config: WebConfig): boolean {
	const path = newConfigPath();
	try {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		const body = `${JSON.stringify(config, null, 2)}
`;
		const tmp = `${path}.${process.pid}.tmp`;
		// mode 0o600: may contain API keys. Atomic rename avoids half-written JSON.
		writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
		renameSync(tmp, path);
		return true;
	} catch {
		return false;
	}
}

export function getProviderChain(config: WebConfig): string[] {
	const configured = (config.providers ?? [])
		.map((provider) => provider.trim())
		.filter((provider) => provider.length > 0);
	if (configured.length > 0) return [...new Set(configured)];
	return [DEFAULT_PROVIDER_NAME];
}

export function getActiveProviderName(config: WebConfig): string {
	return getProviderChain(config)[0] ?? DEFAULT_PROVIDER_NAME;
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

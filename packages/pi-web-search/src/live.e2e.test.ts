import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROVIDERS } from "./providers/registry.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const KEY_FILE = process.env.BYTE_PI_WEB_E2E_CONFIG
	? resolve(process.env.BYTE_PI_WEB_E2E_CONFIG)
	: join(PACKAGE_ROOT, "live.e2e.local.json");

const targeted = process.argv.some((a) => a.includes("live.e2e.test"));
const runLive = process.env.BYTE_PI_WEB_LIVE_E2E === "1" || process.env.npm_lifecycle_event === "test:e2e" || targeted;
const liveDescribe = runLive ? describe : describe.skip;
const QUERY = process.env.BYTE_PI_WEB_E2E_QUERY || "OpenAI Codex CLI documentation";
const MAX_RESULTS = Number(process.env.BYTE_PI_WEB_E2E_MAX_RESULTS || 3);
const SEARCH_PROVIDERS = PROVIDERS.filter((p) => p.roles.includes("search"));
const ALL_PROVIDER_NAMES = SEARCH_PROVIDERS.map((p) => p.name);

interface WebConfig {
	provider?: string;
	providers?: string[];
	apiKeys?: Record<string, string>;
	baseUrls?: Record<string, string>;
	proxy?: string;
	autoFallback?: boolean;
}

function readJson(path: string): WebConfig {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as WebConfig;
	} catch {
		return {};
	}
}

function realConfigPath(): string {
	const base = process.env.PI_CONFIG_DIR?.trim() || join(homedir(), ".pi");
	return join(base, "byte-pi-web", "config.json");
}

function requestedProviders(keyConfig: WebConfig): string[] {
	const raw = process.env.BYTE_PI_WEB_E2E_PROVIDERS?.trim();
	if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
	return keyConfig.providers?.length ? keyConfig.providers : ALL_PROVIDER_NAMES;
}

function providerConfig(name: string, keyConfig: WebConfig, realConfig: WebConfig): WebConfig {
	return {
		apiKeys: keyConfig.apiKeys,
		baseUrls: keyConfig.baseUrls,
		proxy: process.env.BYTE_PI_WEB_E2E_PROXY || keyConfig.proxy || realConfig.proxy,
		provider: name,
		autoFallback: false,
	};
}

function providerSkipReason(name: string, keyConfig: WebConfig): string | undefined {
	const meta = SEARCH_PROVIDERS.find((p) => p.name === name);
	if (!meta) return "unknown provider";
	if (meta.envVar && !(process.env[meta.envVar]?.trim() || keyConfig.apiKeys?.[name]?.trim())) {
		return `missing ${meta.envVar} or apiKeys.${name} in ${KEY_FILE}`;
	}
	if (meta.baseUrlEnvVar && !(process.env[meta.baseUrlEnvVar]?.trim() || keyConfig.baseUrls?.[name]?.trim())) {
		return `missing ${meta.baseUrlEnvVar} or baseUrls.${name} in ${KEY_FILE}`;
	}
	return undefined;
}

function piDistUrl(file: string): string {
	return pathToFileURL(join(REPO_ROOT, "node_modules/@earendil-works/pi-coding-agent/dist", file)).href;
}

async function loadPiModule(file: string): Promise<any> {
	return import(piDistUrl(file));
}

async function loadPiExtensions(paths: string[], cwd: string): Promise<any> {
	const mod = await loadPiModule("core/extensions/loader.js");
	return mod.loadExtensions(paths, cwd);
}

async function resolveProjectWebExtension(repoRoot: string): Promise<string> {
	const [{ SettingsManager }, { DefaultPackageManager }, { getAgentDir }] = await Promise.all([
		loadPiModule("core/settings-manager.js"),
		loadPiModule("core/package-manager.js"),
		loadPiModule("config.js"),
	]);
	const settingsManager = SettingsManager.create(repoRoot, getAgentDir(), { projectTrusted: true });
	const packageManager = new DefaultPackageManager({ cwd: repoRoot, agentDir: getAgentDir(), settingsManager });
	const resolved = await packageManager.resolve(async () => "skip");
	const extension = resolved.extensions.find((e: any) => e.path.includes("pi-web-search") && e.enabled);
	if (!extension) throw new Error("pi-web-search project extension was not resolved from .pi/settings.json");
	return extension.path;
}

liveDescribe("live pi web_search provider e2e", () => {
	let tmpPiConfigDir = "";
	let configPath = "";
	let originalPiConfigDir: string | undefined;
	let tool: any;
	const realConfig = readJson(realConfigPath());
	const keyConfig = readJson(KEY_FILE);
	const providers = requestedProviders(keyConfig);

	beforeAll(async () => {
		originalPiConfigDir = process.env.PI_CONFIG_DIR;
		tmpPiConfigDir = mkdtempSync(join(tmpdir(), "pi-web-e2e-"));
		process.env.PI_CONFIG_DIR = tmpPiConfigDir;
		configPath = join(tmpPiConfigDir, "byte-pi-web", "config.json");
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, JSON.stringify(providerConfig(providers[0] ?? "exa-free", keyConfig, realConfig), null, 2), "utf8");

		const extensionPath = await resolveProjectWebExtension(REPO_ROOT);
		const result = await loadPiExtensions([extensionPath], REPO_ROOT);
		if (result.errors.length) throw new Error(JSON.stringify(result.errors, null, 2));
		tool = result.extensions[0]?.tools.get("web_search")?.definition;
		if (!tool) throw new Error("web_search tool was not registered");
	}, 30_000);

	afterAll(() => {
		if (originalPiConfigDir === undefined) delete process.env.PI_CONFIG_DIR;
		else process.env.PI_CONFIG_DIR = originalPiConfigDir;
		if (tmpPiConfigDir) rmSync(tmpPiConfigDir, { recursive: true, force: true });
	});

	for (const provider of providers) {
		const skipReason = providerSkipReason(provider, keyConfig);
		const test = skipReason ? it.skip : it;
		test(
			`${provider} returns real search results through the registered pi tool${skipReason ? ` (${skipReason})` : ""}`,
			async () => {
				writeFileSync(configPath, JSON.stringify(providerConfig(provider, keyConfig, realConfig), null, 2), "utf8");
				const updates: any[] = [];
				const result = await tool.execute(
					`live-${provider}`,
					{ query: QUERY, max_results: MAX_RESULTS },
					undefined,
					(update: any) => updates.push(update),
					{},
				);

				expect(updates.at(-1)?.details).toMatchObject({ backend: provider, query: QUERY });
				expect(result.details).toMatchObject({ backend: provider, query: QUERY });
				expect(result.details.fellBackFrom, JSON.stringify(result.details, null, 2)).toBeUndefined();
				expect(result.details.results?.length, JSON.stringify(result.details, null, 2)).toBeGreaterThan(0);
				expect(result.details.results[0].url).toMatch(/^https?:\/\//);
			},
			60_000,
		);
	}
});

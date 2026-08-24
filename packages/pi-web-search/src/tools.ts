import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	getActiveProviderName,
	getConfigPath,
	getProviderChain,
	readConfig,
	readConfigResult,
	resolveApiKey,
	type WebConfig,
	writeConfig,
} from "./config.js";
import { fetchViaGenericHtml, parseAndAssertHttpUrl } from "./html.js";
import { PROVIDERS } from "./providers/registry.js";
import type { ProviderMeta, SearchResult } from "./providers/types.js";
import { searchWithProvider } from "./search.js";

const MIN_SEARCH_RESULTS = 1;
const MAX_SEARCH_RESULTS = 10;
const DEFAULT_SEARCH_RESULTS = 5;
const API_KEY_MASK_VISIBLE = 4;
const FETCH_TEMP_DIR_PREFIX = "byte-web-fetch-";
const FETCH_TEMP_FILE_NAME = "content.txt";
const WEB_COMMAND_NAME = "web";
const SHOW_FLAG = "--show";
const UNSET_LABEL = "(not set)";

function clampResultCount(requested: number | undefined): number {
	const value = requested ?? DEFAULT_SEARCH_RESULTS;
	return Math.min(Math.max(value, MIN_SEARCH_RESULTS), MAX_SEARCH_RESULTS);
}

function maskApiKey(key: string | undefined): string {
	if (!key) return UNSET_LABEL;
	if (key.length <= API_KEY_MASK_VISIBLE * 2) return "****";
	return `${key.slice(0, API_KEY_MASK_VISIBLE)}...${key.slice(-API_KEY_MASK_VISIBLE)}`;
}

export function maskProxyUrl(raw: string | undefined): string {
	if (!raw?.trim()) return UNSET_LABEL;
	try {
		const parsed = new URL(raw);
		const credentials = parsed.username || parsed.password ? "****:****@" : "";
		return `${parsed.protocol}//${credentials}${parsed.host}`;
	} catch {
		return "(configured)";
	}
}

export function formatSearchResults(query: string, results: SearchResult[], backend?: string): string {
	let text = `**Search results for "${query}":**\n`;
	if (backend) text += `Search provider: ${backend}\n`;
	text += "\n";
	results.forEach((result, index) => {
		text += `${index + 1}. **${result.title}**\n   ${result.url}\n   ${result.snippet}\n\n`;
	});
	return text.trimEnd();
}

export function registerWebSearchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web for current information. Returns titles, URLs, and snippets from one provider.",
		parameters: Type.Object({
			query: Type.String(),
			max_results: Type.Optional(
				Type.Number({
					default: DEFAULT_SEARCH_RESULTS,
					minimum: MIN_SEARCH_RESULTS,
					maximum: MAX_SEARCH_RESULTS,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate) {
			const maxResults = clampResultCount(params.max_results);
			const config = readConfig();
			const outcome = await searchWithProvider(
				config,
				undefined,
				params.query,
				maxResults,
				signal,
				(progress) => {
					onUpdate?.({
						content: [{ type: "text", text: `Searching ${progress.label} for: "${params.query}"...` }],
						details: { query: params.query, backend: progress.provider, resultCount: 0 },
					});
				},
			);

			if (outcome.results.length === 0) {
				return {
					content: [{ type: "text", text: `No results found for "${params.query}". Provider: ${outcome.backend}.` }],
					details: {
						query: params.query,
						backend: outcome.backend,
						attemptedProviders: outcome.attemptedProviders,
						resultCount: 0,
					},
				};
			}
			return {
				content: [{ type: "text", text: formatSearchResults(params.query, outcome.results, outcome.backend) }],
				details: {
					query: params.query,
					backend: outcome.backend,
					attemptedProviders: outcome.attemptedProviders,
					resultCount: outcome.results.length,
					results: outcome.results,
				},
			};
		},
	});
}

interface FetchDetails {
	url: string;
	title?: string;
	contentType?: string;
	contentLength?: number;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

async function spillToTempFile(content: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), FETCH_TEMP_DIR_PREFIX));
	const file = join(dir, FETCH_TEMP_FILE_NAME);
	await writeFile(file, content, "utf8");
	return file;
}

function truncationFooter(truncation: TruncationResult, tempFile: string): string {
	const lines = truncation.totalLines - truncation.outputLines;
	const bytes = truncation.totalBytes - truncation.outputBytes;
	return (
		`\n\n[Content truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines` +
		` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
		` ${lines} lines (${formatSize(bytes)}) omitted. Full content saved to: ${tempFile}]`
	);
}

function fetchHeader(url: string, title: string | undefined, contentType: string): string {
	const lines = [`**Fetched:** ${url}`];
	if (title) lines.push(`**Title:** ${title}`);
	if (contentType) lines.push(`**Content-Type:** ${contentType}`);
	return `${lines.join("\n")}\n\n`;
}

export function registerWebFetchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: "Fetch one public HTTP(S) URL as readable text, or raw HTML when raw=true.",
		parameters: Type.Object({
			url: Type.String(),
			raw: Type.Optional(Type.Boolean({ description: "Return raw HTML.", default: false })),
		}),

		async execute(_toolCallId, params, signal, onUpdate) {
			const { url, raw = false } = params;
			parseAndAssertHttpUrl(url);
			onUpdate?.({
				content: [{ type: "text", text: `Fetching: ${url}...` }],
				details: { url } as FetchDetails,
			});

			const { text: body, title, contentType, contentLength } = await fetchViaGenericHtml(url, raw, signal);
			const truncation = truncateHead(body, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
			const details: FetchDetails = { url, title, contentType, contentLength };
			let output = truncation.content;
			if (truncation.truncated) {
				const tempFile = await spillToTempFile(body);
				details.truncation = truncation;
				details.fullOutputPath = tempFile;
				output += truncationFooter(truncation, tempFile);
			}
			return {
				content: [{ type: "text", text: fetchHeader(url, title, contentType ?? "") + output }],
				details,
			};
		},
	});
}

function formatShowConfig(config: WebConfig): string {
	const active = getActiveProviderName(config);
	const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
	const proxy = config.proxy?.trim()
		? maskProxyUrl(config.proxy)
		: envProxy
			? `${maskProxyUrl(envProxy)} (from env)`
			: UNSET_LABEL;
	const chain = getProviderChain(config);
	const lines = [
		"Web tools config:",
		`  config file: ${getConfigPath()}`,
		`  provider chain: ${chain.join(" -> ")}`,
		`  active provider: ${active}`,
		`  proxy: ${proxy}`,
		"",
	];
	for (const meta of PROVIDERS) {
		if (meta.keyless) {
			lines.push(`  ${meta.name}: (free, no key)`);
			continue;
		}
		const envKey = meta.envVar ? process.env[meta.envVar]?.trim() : undefined;
		const configKey = config.apiKeys?.[meta.name]?.trim();
		lines.push(
			`  ${meta.name}: ${maskApiKey(envKey ?? configKey)} (env: ${maskApiKey(envKey)}, config: ${maskApiKey(configKey)})`,
		);
	}
	return lines.join("\n");
}

async function configureProxy(
	ctx: { ui: { input(title: string, placeholder?: string): Promise<string | undefined>; notify(message: string, type?: string): void } },
	config: WebConfig,
): Promise<void> {
	const current = config.proxy?.trim();
	const input = await ctx.ui.input(
		"HTTP proxy URL for web tools (e.g. http://127.0.0.1:7890)",
		current ? `Press Enter to keep (${maskProxyUrl(current)}), type "off" to clear, or a new URL` : 'e.g. http://127.0.0.1:7890 (or "off")',
	);
	if (input == null || input.trim() === "") {
		ctx.ui.notify("Web config unchanged", "info");
		return;
	}
	const next: WebConfig = { ...config };
	if (input.trim().toLowerCase() === "off") delete next.proxy;
	else next.proxy = input.trim();
	if (!writeConfig(next)) {
		ctx.ui.notify(`Failed to save proxy to ${getConfigPath()}`, "error");
		return;
	}
	ctx.ui.notify(`${next.proxy ? `Proxy set to ${maskProxyUrl(next.proxy)}` : "Proxy cleared"}. Run /reload (or restart pi) to apply.`, "info");
}

export function needsBaseUrlPrompt(meta: ProviderMeta, config: WebConfig): boolean {
	if (!meta.baseUrlEnvVar) return false;
	return !process.env[meta.baseUrlEnvVar]?.trim() && !config.baseUrls?.[meta.name]?.trim();
}

async function configureBaseUrl(
	ctx: { ui: { input(title: string, placeholder?: string): Promise<string | undefined>; notify(message: string, type?: string): void } },
	config: WebConfig,
	meta: ProviderMeta,
): Promise<void> {
	const placeholder = meta.defaultBaseUrl ? `e.g. ${meta.defaultBaseUrl}` : `set ${meta.baseUrlEnvVar}`;
	const input = await ctx.ui.input(`${meta.label} base URL`, placeholder);
	if (input == null || !input.trim()) {
		ctx.ui.notify("Web config unchanged (no URL provided)", "info");
		return;
	}
	const next: WebConfig = {
		...config,
		providers: [meta.name, ...getProviderChain(config).filter((provider) => provider !== meta.name)],
		baseUrls: { ...config.baseUrls, [meta.name]: input.trim() },
	};
	delete next.provider;
	if (!writeConfig(next)) {
		ctx.ui.notify(`Failed to save ${meta.label} URL to ${getConfigPath()}`, "error");
		return;
	}
	ctx.ui.notify(`Saved ${meta.label} URL and set as active provider`, "info");
}

async function configureProviderChain(
	ctx: { ui: { select(title: string, options: string[], settings?: unknown): Promise<string | undefined>; notify(message: string, type?: string): void } },
	config: WebConfig,
 ): Promise<void> {
	const isConfigured = (provider: ProviderMeta) =>
		(resolveApiKey(provider.name, config) !== undefined) ||
		(provider.keyless && !provider.baseUrlEnvVar) ||
		(provider.baseUrlEnvVar ? !needsBaseUrlPrompt(provider, config) : false);
	const labelOf = (provider: ProviderMeta, position?: number) => {
		const markers: string[] = [];
		if (position !== undefined) markers.push(`${position}.`);
		if (provider.keyless) markers.push("(free)");
		if (isConfigured(provider)) markers.push("(configured)");
		return markers.length ? `${provider.label} ${markers.join(" ")}` : provider.label;
	};
	const current = getProviderChain(config);
	const selected: string[] = [];
	const selectable = PROVIDERS.filter((provider) => isConfigured(provider));

	while (true) {
		const options = selectable
			.filter((provider) => !selected.includes(provider.name))
			.map((provider) => labelOf(provider));
		if (selected.length > 0) options.push("✓ Done");
		options.push("Cancel");
		const currentLabel = selected.length ? selected.join(" -> ") : current.join(" -> ");
		const picked = await ctx.ui.select(`Web provider chain (current: ${currentLabel})`, options, {});
		if (!picked || picked === "Cancel") {
			ctx.ui.notify("Web config unchanged", "info");
			return;
		}
		if (picked === "✓ Done") {
			const next: WebConfig = { ...config, providers: [...selected] };
			delete next.provider;
			if (writeConfig(next)) ctx.ui.notify(`Provider chain saved: ${selected.join(" -> ")}`, "info");
			else ctx.ui.notify(`Failed to save provider chain to ${getConfigPath()}`, "error");
			return;
		}
		const provider = selectable.find((candidate) => picked === labelOf(candidate));
		if (provider) selected.push(provider.name);
	}
}

export function registerWebCommand(pi: ExtensionAPI): void {
	pi.registerCommand(WEB_COMMAND_NAME, {
		description: "Configure web_search providers, keys, base URLs, and proxy",
		handler: async (args, ctx) => {
			const loaded = readConfigResult();
			if (loaded.status === "invalid") {
				ctx.ui?.notify?.(`${loaded.error}. Fix or remove the config file before using /${WEB_COMMAND_NAME}.`, "error");
				return;
			}
			const config = loaded.config;
			if (typeof args === "string" && args.includes(SHOW_FLAG)) {
				ctx.ui?.notify?.(formatShowConfig(config), "info");
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui?.notify?.(`/${WEB_COMMAND_NAME} requires interactive mode (use /${WEB_COMMAND_NAME} ${SHOW_FLAG} to print config)`, "error");
				return;
			}

			const active = getActiveProviderName(config);
			const ordered = [...PROVIDERS.filter((provider) => provider.name === active), ...PROVIDERS.filter((provider) => provider.name !== active)];
			const labelOf = (provider: ProviderMeta) => {
				const markers: string[] = [];
				if (provider.name === active) markers.push("✓");
				if (provider.keyless) markers.push("(free)");
				if (resolveApiKey(provider.name, config) !== undefined || (provider.baseUrlEnvVar ? !needsBaseUrlPrompt(provider, config) : false)) markers.push("(configured)");
				return markers.length ? `${provider.label} ${markers.join(" ")}` : provider.label;
			};
			const providerOptions = ordered.map((provider) => ({ provider, label: labelOf(provider) }));
			const chainEntry = `Configure provider fallback chain… (current: ${getProviderChain(config).join(" -> ")})`;
			const proxyEntry = `⚙ Set HTTP proxy… (current: ${maskProxyUrl(config.proxy)})`;
			const selected = await ctx.ui.select("Web search provider", [...providerOptions.map((option) => option.label), chainEntry, proxyEntry], {});
			if (selected == null) {
				ctx.ui.notify("Web config unchanged", "info");
				return;
			}
			if (selected === chainEntry) {
				await configureProviderChain(ctx, config);
				return;
			}
			if (selected === proxyEntry) {
				await configureProxy(ctx, config);
				return;
			}
			const meta = providerOptions.find((option) => selected === option.label)?.provider;
			if (!meta) {
				ctx.ui.notify("Web config unchanged", "info");
				return;
			}
			if (needsBaseUrlPrompt(meta, config)) {
				await configureBaseUrl(ctx, config, meta);
				return;
			}
			if (meta.keyless || resolveApiKey(meta.name, config) !== undefined) {
				const next: WebConfig = { ...config, providers: [meta.name, ...getProviderChain(config).filter((provider) => provider !== meta.name)] };
				delete next.provider;
				if (writeConfig(next)) ctx.ui.notify(`Active provider set to ${meta.label}`, "info");
				else ctx.ui.notify(`Failed to save config to ${getConfigPath()}`, "error");
				return;
			}
			const hint = meta.signupUrl ? ` (get one at ${meta.signupUrl})` : "";
			const input = await ctx.ui.input(`${meta.label} API key${hint}`, "paste your API key");
			if (input == null || !input.trim()) {
				ctx.ui.notify("Web config unchanged (no key provided)", "info");
				return;
			}
			const toSave: WebConfig = {
				...config,
				providers: [meta.name, ...getProviderChain(config).filter((provider) => provider !== meta.name)],
				apiKeys: { ...config.apiKeys, [meta.name]: input.trim() },
			};
			delete toSave.provider;
			if (!writeConfig(toSave)) ctx.ui.notify(`Failed to save ${meta.label} key to ${getConfigPath()}`, "error");
			else ctx.ui.notify(`Saved ${meta.label} key and set as active provider`, "info");
		},
	});
}

/**
 * web_search + web_fetch tools and the /web config command.
 *
 * Two tools, same surface as Claude Code / Codex CLI. The default provider is
 * keyless Exa MCP free, so this works with zero configuration; /web (or env vars)
 * swaps in a key-backed provider for higher reliability.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	getActiveProviderName,
	getConfigPath,
	readConfig,
	readConfigResult,
	resolveApiKey,
	resolveBaseUrl,
	type WebConfig,
	writeConfig,
} from "./config.js";
import { fetchViaGenericHtml, parseAndAssertHttpUrl } from "./html.js";
import { createProvider } from "./providers/factory.js";
import { PROVIDERS } from "./providers/registry.js";
import type { AnyProvider, FetchResponse, ProviderMeta, SearchResult } from "./providers/types.js";
import { searchWithFallback } from "./search.js";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const MIN_SEARCH_RESULTS = 1;
const MAX_SEARCH_RESULTS = 10;
const DEFAULT_SEARCH_RESULTS = 5;

const SEARCH_RESULT_PREVIEW_LIMIT = 5;
const FETCH_PREVIEW_LINE_LIMIT = 15;
const API_KEY_MASK_VISIBLE = 4;

const FETCH_TEMP_DIR_PREFIX = "byte-web-fetch-";
const FETCH_TEMP_FILE_NAME = "content.txt";

const WEB_COMMAND_NAME = "web";
const SHOW_FLAG = "--show";
const UNSET_LABEL = "(not set)";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function instantiateActiveProvider(config: WebConfig): { providerName: string; provider: AnyProvider } {
	const providerName = getActiveProviderName(config);
	const apiKey = resolveApiKey(providerName, config);
	return { providerName, provider: createProvider(providerName, { apiKey }) };
}

function clampResultCount(requested: number | undefined): number {
	const value = requested ?? DEFAULT_SEARCH_RESULTS;
	return Math.min(Math.max(value, MIN_SEARCH_RESULTS), MAX_SEARCH_RESULTS);
}

function maskApiKey(key: string | undefined): string {
	if (!key) return UNSET_LABEL;
	if (key.length <= API_KEY_MASK_VISIBLE * 2) return "****";
	return `${key.slice(0, API_KEY_MASK_VISIBLE)}...${key.slice(-API_KEY_MASK_VISIBLE)}`;
}

// ---------------------------------------------------------------------------
// web_search
// ---------------------------------------------------------------------------

const WEB_SEARCH_SNIPPET = "Search the web for up-to-date information";
const WEB_SEARCH_GUIDELINES: string[] = [
	"Use web_search for information beyond your training data — recent events, current library versions, live docs.",
	'Use the current year from "Current date:" in your context when searching for recent information.',
	'After answering using search results, include a "Sources:" section listing the URLs as markdown links: [Title](URL).',
	"If results look weak or off-topic, retry with a more specific query. The tool already fails over across search providers automatically, so do not tell the user to switch providers.",
];

interface SearchDetails {
	query?: string;
	backend?: string;
	resultCount?: number;
	results?: SearchResult[];
	attempted?: string[];
	fellBackFrom?: string[];
}

export function formatSearchResults(query: string, results: SearchResult[], details: SearchDetails = {}): string {
	let text = `**Search results for "${query}":**\n`;
	if (details.backend) text += `Search provider: ${details.backend}\n`;
	const attempts = details.fellBackFrom ?? details.attempted;
	if (attempts?.length) text += `Fallback: ${attempts.join("; ")}\n`;
	text += "\n";
	results.forEach((r, i) => {
		text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n\n`;
	});
	return text.trimEnd();
}

function renderSearchPreview(details: SearchDetails | undefined, expanded: boolean, theme: Theme): string {
	const count = details?.resultCount ?? 0;
	const backend = details?.backend ? ` via ${details.backend}` : "";
	const query = details?.query ? ` for "${details.query}"` : "";
	let text = theme.fg("success", `✓ ${count} result${count !== 1 ? "s" : ""}${backend}${query}`);

	if (!expanded) return text;

	const attempts = details?.fellBackFrom ?? details?.attempted;
	if (attempts?.length) text += `\n${theme.fg("dim", `Fallback: ${attempts.join("; ")}`)}`;

	for (const [i, r] of (details?.results ?? []).entries()) {
		text += `\n${theme.fg("accent", `${i + 1}. ${r.title || r.url}`)}`;
		if (r.url) text += `\n  ${theme.fg("muted", r.url)}`;
		if (r.snippet) text += `\n  ${theme.fg("dim", r.snippet)}`;
	}
	return text;
}

export function registerWebSearchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web for information. Returns a list of results with titles, URLs, and snippets. Use when you need current information not in your training data.",
		promptSnippet: WEB_SEARCH_SNIPPET,
		promptGuidelines: WEB_SEARCH_GUIDELINES,
		parameters: Type.Object({
			query: Type.String({ description: "The search query. Be specific and use natural language." }),
			max_results: Type.Optional(
				Type.Number({
					description: `Maximum number of results (${MIN_SEARCH_RESULTS}-${MAX_SEARCH_RESULTS}). Default: ${DEFAULT_SEARCH_RESULTS}.`,
					default: DEFAULT_SEARCH_RESULTS,
					minimum: MIN_SEARCH_RESULTS,
					maximum: MAX_SEARCH_RESULTS,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const maxResults = clampResultCount(params.max_results);
			const config = readConfig();

			const outcome = await searchWithFallback(config, params.query, maxResults, signal, (p) => {
				onUpdate?.({
					content: [
						{
							type: "text",
							text: p.previousFailure
								? `${p.previousFailure} failed — trying ${p.label}...`
								: `Searching ${p.label} for: "${params.query}"...`,
						},
					],
					details: { query: params.query, backend: p.provider, resultCount: 0 },
				});
			});

			if (outcome.results.length === 0) {
				const provider = outcome.backend ? ` Provider: ${outcome.backend}.` : "";
				const detail = outcome.attempted.length ? ` Tried — ${outcome.attempted.join("; ")}.` : "";
				return {
					content: [{ type: "text", text: `No results found for "${params.query}".${provider}${detail}` }],
					details: { query: params.query, backend: outcome.backend, resultCount: 0, attempted: outcome.attempted },
				};
			}

			return {
				content: [{ type: "text", text: formatSearchResults(params.query, outcome.results, { backend: outcome.backend, ...(outcome.fellBack ? { fellBackFrom: outcome.attempted } : {}) }) }],
				details: {
					query: params.query,
					backend: outcome.backend,
					resultCount: outcome.results.length,
					results: outcome.results,
					...(outcome.fellBack ? { fellBackFrom: outcome.attempted } : {}),
				},
			};
		},

		renderCall(args, theme, _context) {
			return new Text(`${theme.fg("toolTitle", theme.bold("WebSearch "))}${theme.fg("accent", `"${args.query}"`)}`, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			const details = result.details as SearchDetails | undefined;
			if (isPartial) {
				const backend = details?.backend ? ` ${details.backend}` : "";
				const query = details?.query ? ` for "${details.query}"` : "";
				return new Text(theme.fg("warning", `Searching${backend}${query}...`), 0, 0);
			}
			return new Text(renderSearchPreview(details, expanded, theme), 0, 0);
		},
	});
}

// ---------------------------------------------------------------------------
// web_fetch
// ---------------------------------------------------------------------------

const WEB_FETCH_SNIPPET = "Fetch and read content from a specific URL";
const WEB_FETCH_GUIDELINES: string[] = [
	"Use web_fetch to read the full content of a specific URL — docs pages, blog posts, API references found via web_search.",
	"web_fetch complements web_search: search finds URLs, fetch reads them.",
	'After answering using fetched content, include a "Sources:" section with a markdown link to the fetched URL.',
	"Large responses are truncated and spilled to a temp file — the temp path is reported in the result details.",
	"Decoded response bodies over 10 MiB are rejected before context truncation.",
];

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

function truncationFooter(t: TruncationResult, tempFile: string): string {
	const lines = t.totalLines - t.outputLines;
	const bytes = t.totalBytes - t.outputBytes;
	return (
		`\n\n[Content truncated: showing ${t.outputLines} of ${t.totalLines} lines` +
		` (${formatSize(t.outputBytes)} of ${formatSize(t.totalBytes)}).` +
		` ${lines} lines (${formatSize(bytes)}) omitted. Full content saved to: ${tempFile}]`
	);
}

function fetchHeader(url: string, title: string | undefined, contentType: string): string {
	const lines = [`**Fetched:** ${url}`];
	if (title) lines.push(`**Title:** ${title}`);
	if (contentType) lines.push(`**Content-Type:** ${contentType}`);
	return `${lines.join("\n")}\n\n`;
}

function renderFetchPreview(content: string, theme: Theme): string {
	const lines = content.split("\n");
	let text = "";
	for (const line of lines.slice(0, FETCH_PREVIEW_LINE_LIMIT)) text += `\n  ${theme.fg("dim", line)}`;
	if (lines.length > FETCH_PREVIEW_LINE_LIMIT) {
		text += `\n  ${theme.fg("muted", "... (use read tool to see full content)")}`;
	}
	return text;
}

export function registerWebFetchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch the content of a specific URL. Returns extracted text for HTML pages, raw text for plain/JSON. http and https only. Content is truncated to avoid overwhelming the context window.",
		promptSnippet: WEB_FETCH_SNIPPET,
		promptGuidelines: WEB_FETCH_GUIDELINES,
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch. Must be http or https." }),
			raw: Type.Optional(
				Type.Boolean({ description: "If true, return raw HTML instead of extracted text. Default: false.", default: false }),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const { url, raw = false } = params;
			parseAndAssertHttpUrl(url);

			onUpdate?.({
				content: [{ type: "text", text: `Fetching: ${url}...` }],
				details: { url } as FetchDetails,
			});

			const { provider } = instantiateActiveProvider(readConfig());

			// Provider's native fetch (Tavily/Exa/Jina/Firecrawl) if present;
			// otherwise the keyless generic HTML extractor. If the provider's
			// fetch fails, fall back to the generic extractor automatically.
			let response: FetchResponse;
			if ("fetch" in provider) {
				try {
					response = await provider.fetch(url, raw, signal);
				} catch (err) {
					if (signal?.aborted) throw err;
					onUpdate?.({
						content: [{ type: "text", text: `Provider fetch failed — falling back to direct fetch...` }],
						details: { url } as FetchDetails,
					});
					response = await fetchViaGenericHtml(url, raw, signal);
				}
			} else {
				response = await fetchViaGenericHtml(url, raw, signal);
			}

			const { text: body, title, contentType, contentLength } = response;
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

		renderCall(args, theme, _context) {
			return new Text(`${theme.fg("toolTitle", theme.bold("WebFetch "))}${theme.fg("accent", args.url)}`, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) return new Text(theme.fg("warning", "Fetching..."), 0, 0);
			const details = result.details as FetchDetails | undefined;
			let text = theme.fg("success", "✓ Fetched");
			if (details?.title) text += theme.fg("muted", `: ${details.title}`);
			if (details?.truncation?.truncated) text += theme.fg("warning", " (truncated)");
			if (expanded) {
				const content = result.content[0];
				if (content?.type === "text") text += renderFetchPreview(content.text, theme);
			}
			return new Text(text, 0, 0);
		},
	});
}

// ---------------------------------------------------------------------------
// /web command
// ---------------------------------------------------------------------------

function formatShowConfig(config: WebConfig): string {
	const active = getActiveProviderName(config);
	const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
	const proxy = config.proxy?.trim() || (envProxy ? `${envProxy} (from env)` : UNSET_LABEL);
	const lines = [
		"Web tools config:",
		`  config file: ${getConfigPath()}`,
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
		const resolved = envKey ?? configKey;
		lines.push(
			`  ${meta.name}: ${maskApiKey(resolved)} (env: ${maskApiKey(envKey)}, config: ${maskApiKey(configKey)})`,
		);
	}
	return lines.join("\n");
}

// Prompt for and persist the HTTP proxy. Empty input clears it. The proxy
// dispatcher is installed at load, so a change takes effect after /reload.
async function configureProxy(
	ctx: { ui: { input(t: string, p?: string): Promise<string | undefined>; notify(m: string, t?: string): void } },
	config: WebConfig,
): Promise<void> {
	const current = config.proxy?.trim();
	const input = await ctx.ui.input(
		"HTTP proxy URL for web tools (e.g. http://127.0.0.1:7890)",
		current ? `Press Enter to keep (${current}), type "off" to clear, or a new URL` : 'e.g. http://127.0.0.1:7890 (or "off")',
	);
	if (input == null) {
		ctx.ui.notify("Web config unchanged", "info");
		return;
	}
	const trimmed = input.trim();
	const next: WebConfig = { ...config };
	if (trimmed === "" ) {
		// keep current
		ctx.ui.notify("Web config unchanged", "info");
		return;
	}
	if (trimmed.toLowerCase() === "off") {
		delete (next as { proxy?: string }).proxy;
	} else {
		next.proxy = trimmed;
	}
	if (!writeConfig(next)) {
		ctx.ui.notify(`Failed to save proxy to ${getConfigPath()}`, "error");
		return;
	}
	ctx.ui.notify(
		`${next.proxy ? `Proxy set to ${next.proxy}` : "Proxy cleared"}. Run /reload (or restart pi) to apply.`,
		"info",
	);
}

export function needsBaseUrlPrompt(meta: ProviderMeta, config: WebConfig): boolean {
	if (!meta.baseUrlEnvVar) return false;
	const envUrl = process.env[meta.baseUrlEnvVar]?.trim();
	const configUrl = config.baseUrls?.[meta.name]?.trim();
	return !envUrl && !configUrl;
}

async function configureBaseUrl(
	ctx: { ui: { input(t: string, p?: string): Promise<string | undefined>; notify(m: string, t?: string): void } },
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
		provider: meta.name,
		baseUrls: { ...config.baseUrls, [meta.name]: input.trim() },
	};
	if (!writeConfig(next)) {
		ctx.ui.notify(`Failed to save ${meta.label} URL to ${getConfigPath()}`, "error");
		return;
	}
	ctx.ui.notify(`Saved ${meta.label} URL and set as active provider`, "info");
}

export function registerWebCommand(pi: ExtensionAPI): void {
	pi.registerCommand(WEB_COMMAND_NAME, {
		description: "Configure the web_search / web_fetch provider and API keys",
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
			const ordered = [...PROVIDERS.filter((p) => p.name === active), ...PROVIDERS.filter((p) => p.name !== active)];
			const isConfigured = (p: ProviderMeta) => resolveApiKey(p.name, config) !== undefined || (p.baseUrlEnvVar ? !needsBaseUrlPrompt(p, config) : false);
			const labelOf = (p: ProviderMeta) => {
				const markers: string[] = [];
				if (p.name === active) markers.push("✓");
				if (p.keyless) markers.push("(free)");
				if (isConfigured(p)) markers.push("(configured)");
				return markers.length ? `${p.label} ${markers.join(" ")}` : p.label;
			};

			const PROXY_ENTRY = `⚙ Set HTTP proxy… (current: ${config.proxy?.trim() || UNSET_LABEL})`;
			const selected = await ctx.ui.select(
				"Web search provider",
				[...ordered.map((p) => labelOf(p)), PROXY_ENTRY],
				{},
			);
			if (selected == null) {
				ctx.ui.notify("Web config unchanged", "info");
				return;
			}

			if (selected === PROXY_ENTRY) {
				await configureProxy(ctx, config);
				return;
			}

			const meta = ordered.find((p) => selected === p.label || selected.startsWith(`${p.label} `));
			if (!meta) {
				ctx.ui.notify("Web config unchanged", "info");
				return;
			}

			if (needsBaseUrlPrompt(meta, config)) {
				await configureBaseUrl(ctx, config, meta);
				return;
			}

			// Keyless provider: just switch and persist after any required base URL is configured.
			if (meta.keyless) {
				if (writeConfig({ ...config, provider: meta.name })) {
					ctx.ui.notify(`Active provider set to ${meta.label}`, "info");
				} else {
					ctx.ui.notify(`Failed to save config to ${getConfigPath()}`, "error");
				}
				return;
			}

			// Already configured (key in config or from env): just activate it —
			// don't re-prompt for a key. To change a key, edit the config file's
			// apiKeys, or clear it there and reselect here.
			if (resolveApiKey(meta.name, config) !== undefined) {
				if (!writeConfig({ ...config, provider: meta.name })) {
					ctx.ui.notify(`Failed to save config to ${getConfigPath()}`, "error");
					return;
				}
				ctx.ui.notify(`Active provider set to ${meta.label} (using existing key)`, "info");
				return;
			}

			// Not configured yet: prompt for a key.
			const hint = meta.signupUrl ? ` (get one at ${meta.signupUrl})` : "";
			const input = await ctx.ui.input(`${meta.label} API key${hint}`, "paste your API key");
			if (input == null || !input.trim()) {
				ctx.ui.notify("Web config unchanged (no key provided)", "info");
				return;
			}

			const toSave: WebConfig = {
				...config,
				provider: meta.name,
				apiKeys: { ...config.apiKeys, [meta.name]: input.trim() },
			};
			if (!writeConfig(toSave)) {
				ctx.ui.notify(`Failed to save ${meta.label} key to ${getConfigPath()}`, "error");
				return;
			}
			ctx.ui.notify(`Saved ${meta.label} key and set as active provider`, "info");
		},
	});
}

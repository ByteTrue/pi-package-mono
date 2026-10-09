/** Instantiate a provider by name. The only place that maps name → provider. */

import { BingProvider } from "./bing.js";
import { ExaMcpFreeProvider } from "./exa-free.js";
import { JsonSearchProvider, type JsonProviderSpec } from "./json-provider.js";
import type { ProviderCredentials, SearchProvider } from "./types.js";

// One spec per JSON API provider (BYTE-6 Lean): the seven JSON providers are
// the same shape — build a request, throw on !ok, read a bounded JSON body,
// map result fields. bing (HTML scraping) and exa-free (MCP over SSE) have
// custom transports and stay dedicated classes.
export const JSON_PROVIDER_SPECS: Record<string, JsonProviderSpec> = {
	bocha: {
		name: "bocha",
		label: "Bocha (博查)",
		envVar: "BOCHA_API_KEY",
		url: "https://api.bochaai.com/v1/web-search",
		method: "POST",
		authHeaderName: "authorization",
		body: (query, maxResults) => ({ query, summary: true, count: maxResults, freshness: "noLimit" }),
		resultsPath: "data.webPages.value",
		fields: { title: "name", url: "url", snippet: ["summary", "snippet"] },
	},
	tavily: {
		name: "tavily",
		label: "Tavily",
		envVar: "TAVILY_API_KEY",
		url: "https://api.tavily.com/search",
		method: "POST",
		authHeaderName: "authorization",
		body: (query, maxResults) => ({ query, max_results: maxResults }),
		resultsPath: "results",
		fields: { title: "title", url: "url", snippet: "content" },
	},
	exa: {
		name: "exa",
		label: "Exa",
		envVar: "EXA_API_KEY",
		url: "https://api.exa.ai/search",
		method: "POST",
		authHeaderName: "x-api-key",
		body: (query, maxResults) => ({ query, numResults: maxResults, contents: { text: { maxCharacters: 300 } } }),
		resultsPath: "results",
		fields: { title: "title", url: "url", snippet: "text" },
	},
	brave: {
		name: "brave",
		label: "Brave Search",
		envVar: "BRAVE_SEARCH_API_KEY",
		url: "https://api.search.brave.com/res/v1/web/search",
		method: "GET",
		headers: { Accept: "application/json", "Accept-Encoding": "gzip" },
		authHeaderName: "X-Subscription-Token",
		queryParams: (query, maxResults) => ({ q: query, count: String(maxResults) }),
		resultsPath: "web.results",
		fields: { title: "title", url: "url", snippet: "description" },
	},
	jina: {
		name: "jina",
		label: "Jina",
		envVar: "JINA_API_KEY",
		url: (query) => `https://s.jina.ai/${encodeURIComponent(query)}`,
		method: "GET",
		authHeaderName: "authorization",
		queryParams: (_query, maxResults) => ({ num: String(maxResults) }),
		resultsPath: "data.results",
		fields: { title: "title", url: "url", snippet: "description" },
	},
	firecrawl: {
		name: "firecrawl",
		label: "Firecrawl",
		envVar: "FIRECRAWL_API_KEY",
		url: "https://api.firecrawl.dev/v1/search",
		method: "POST",
		authHeaderName: "authorization",
		body: (query, maxResults) => ({ query, limit: maxResults }),
		resultsPath: "data",
		fields: { title: "title", url: "url", snippet: "description" },
	},
	searxng: {
		name: "searxng",
		label: "SearXNG (self-hosted)",
		url: (query, _maxResults, baseUrl) => `${(baseUrl ?? "").replace(/\/+$/, "")}/search`,
		method: "GET",
		headers: { Accept: "application/json" },
		queryParams: (query, maxResults) => ({ q: query, format: "json", limit: String(maxResults) }),
		resultsPath: "results",
		fields: { title: "title", url: "url", snippet: "content" },
		errorHint: "; check the configured URL and JSON format support",
	},
};

export function createProvider(name: string, creds: ProviderCredentials = {}): SearchProvider {
	const apiKey = creds.apiKey ?? "";
	const baseUrl = creds.baseUrl ?? "";
	switch (name) {
		case "exa-free":
			return new ExaMcpFreeProvider();
		case "bing":
			return new BingProvider();
		default: {
			const spec = JSON_PROVIDER_SPECS[name];
			// resolveBaseUrl already falls back to the registry defaultBaseUrl, so
			// baseUrl is populated for every provider that needs one.
			if (!spec) throw new Error(`Unknown web provider: "${name}"`);
			return new JsonSearchProvider(spec, apiKey, baseUrl || undefined);
		}
	}
}

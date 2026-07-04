/**
 * Provider registry — the single source of truth for which providers exist and
 * how they are configured. /web and the key-resolution logic iterate this list,
 * so a new provider lands by adding one entry here and one provider file.
 */

import type { ProviderMeta } from "./types.js";

export const DEFAULT_PROVIDER_NAME = "exa-free";

export const PROVIDERS: ReadonlyArray<ProviderMeta> = [
	{
		name: "exa-free",
		label: "Exa (free, no key — neural search via Exa MCP)",
		roles: ["search"],
		keyless: true,
	},
	{
		name: "bing",
		label: "Bing (free, no key — works in mainland China)",
		roles: ["search"],
		keyless: true,
	},
	{
		name: "searxng",
		label: "SearXNG (self-hosted, no key — requires SEARXNG_URL)",
		baseUrlEnvVar: "SEARXNG_URL",
		defaultBaseUrl: "http://localhost:8080",
		roles: ["search"],
		keyless: true,
	},
	{
		name: "bocha",
		label: "Bocha 博查 (China, LLM-optimized)",
		envVar: "BOCHA_API_KEY",
		roles: ["search"],
		signupUrl: "https://open.bochaai.com",
	},
	{
		name: "tavily",
		label: "Tavily",
		envVar: "TAVILY_API_KEY",
		roles: ["search", "fetch"],
		signupUrl: "https://app.tavily.com",
	},
	{
		name: "exa",
		label: "Exa",
		envVar: "EXA_API_KEY",
		roles: ["search", "fetch"],
		signupUrl: "https://dashboard.exa.ai/api-keys",
	},
	{
		name: "brave",
		label: "Brave Search",
		envVar: "BRAVE_SEARCH_API_KEY",
		roles: ["search"],
		signupUrl: "https://api-dashboard.search.brave.com",
	},
	{
		name: "jina",
		label: "Jina (search + reader)",
		envVar: "JINA_API_KEY",
		roles: ["search", "fetch"],
		signupUrl: "https://jina.ai/reader",
	},
	{
		name: "firecrawl",
		label: "Firecrawl (search + scrape)",
		envVar: "FIRECRAWL_API_KEY",
		roles: ["search", "fetch"],
		signupUrl: "https://www.firecrawl.dev/app/api-keys",
	},
];

export function findProviderMeta(name: string): ProviderMeta | undefined {
	return PROVIDERS.find((p) => p.name === name);
}

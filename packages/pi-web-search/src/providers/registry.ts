import type { ProviderMeta } from "./types.js";

export const DEFAULT_PROVIDER_NAME = "exa-free";

export const PROVIDERS: ReadonlyArray<ProviderMeta> = [
	{
		name: "exa-free",
		label: "Exa (free, no key — neural search via Exa MCP)",
		keyless: true,
	},
	{
		name: "bing",
		label: "Bing (free, no key — works in mainland China)",
		keyless: true,
	},
	{
		name: "searxng",
		label: "SearXNG (self-hosted, no key — requires SEARXNG_URL)",
		baseUrlEnvVar: "SEARXNG_URL",
		defaultBaseUrl: "http://localhost:8080",
		keyless: true,
	},
	{
		name: "bocha",
		label: "Bocha 博查 (China, LLM-optimized)",
		envVar: "BOCHA_API_KEY",
		signupUrl: "https://open.bochaai.com",
	},
	{
		name: "tavily",
		label: "Tavily",
		envVar: "TAVILY_API_KEY",
		signupUrl: "https://app.tavily.com",
	},
	{
		name: "exa",
		label: "Exa",
		envVar: "EXA_API_KEY",
		signupUrl: "https://dashboard.exa.ai/api-keys",
	},
	{
		name: "brave",
		label: "Brave Search",
		envVar: "BRAVE_SEARCH_API_KEY",
		signupUrl: "https://api-dashboard.search.brave.com",
	},
	{
		name: "jina",
		label: "Jina",
		envVar: "JINA_API_KEY",
		signupUrl: "https://jina.ai/reader",
	},
	{
		name: "firecrawl",
		label: "Firecrawl",
		envVar: "FIRECRAWL_API_KEY",
		signupUrl: "https://www.firecrawl.dev/app/api-keys",
	},
];

export function findProviderMeta(name: string): ProviderMeta | undefined {
	return PROVIDERS.find((provider) => provider.name === name);
}

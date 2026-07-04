/** Instantiate a provider by name. The only place that maps name → class. */

import { BingProvider } from "./bing.js";
import { BochaProvider } from "./bocha.js";
import { BraveProvider } from "./brave.js";
import { ExaMcpFreeProvider } from "./exa-free.js";
import { ExaProvider } from "./exa.js";
import { FirecrawlProvider } from "./firecrawl.js";
import { JinaProvider } from "./jina.js";
import { SearxngProvider } from "./searxng.js";
import { TavilyProvider } from "./tavily.js";
import type { AnyProvider, ProviderCredentials } from "./types.js";

export function createProvider(name: string, creds: ProviderCredentials = {}): AnyProvider {
	const apiKey = creds.apiKey ?? "";
	const baseUrl = creds.baseUrl ?? "";
	switch (name) {
		case "exa-free":
			return new ExaMcpFreeProvider();
		case "bing":
			return new BingProvider();
		case "searxng":
			return new SearxngProvider(baseUrl || undefined);
		case "bocha":
			return new BochaProvider(apiKey);
		case "tavily":
			return new TavilyProvider(apiKey);
		case "exa":
			return new ExaProvider(apiKey);
		case "brave":
			return new BraveProvider(apiKey);
		case "jina":
			return new JinaProvider(apiKey);
		case "firecrawl":
			return new FirecrawlProvider(apiKey);
		default:
			throw new Error(`Unknown web provider: "${name}"`);
	}
}

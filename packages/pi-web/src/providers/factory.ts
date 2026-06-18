/** Instantiate a provider by name. The only place that maps name → class. */

import { BingProvider } from "./bing.js";
import { BochaProvider } from "./bocha.js";
import { BraveProvider } from "./brave.js";
import { DuckDuckGoProvider } from "./duckduckgo.js";
import { ExaProvider } from "./exa.js";
import { FirecrawlProvider } from "./firecrawl.js";
import { JinaProvider } from "./jina.js";
import { TavilyProvider } from "./tavily.js";
import type { AnyProvider, ProviderCredentials } from "./types.js";

export function createProvider(name: string, creds: ProviderCredentials = {}): AnyProvider {
	const apiKey = creds.apiKey ?? "";
	switch (name) {
		case "duckduckgo":
			return new DuckDuckGoProvider();
		case "bing":
			return new BingProvider();
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

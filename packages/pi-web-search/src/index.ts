/**
 * @bytetrue/pi-web — web_search + web_fetch for the pi coding agent.
 *
 * Zero-config: the default provider is keyless Exa MCP free, so the two tools
 * work the moment the package loads. Run /web (or set per-provider env vars) to
 * switch to a key-backed provider (Tavily, Exa, Brave, Jina, Firecrawl).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readConfig } from "./config.js";
import { installProxyDispatcher } from "./proxy.js";
import { registerWebCommand, registerWebFetchTool, registerWebSearchTool } from "./tools.js";

export { createProvider } from "./providers/factory.js";
export { DEFAULT_PROVIDER_NAME, PROVIDERS } from "./providers/registry.js";
export type {
	AnyProvider,
	FetchResponse,
	FullProvider,
	SearchProvider,
	SearchResponse,
	SearchResult,
} from "./providers/types.js";
export { installProxyDispatcher } from "./proxy.js";
export { registerWebCommand, registerWebFetchTool, registerWebSearchTool } from "./tools.js";

export default async function registerWebTools(pi: ExtensionAPI): Promise<void> {
	// Configure package-scoped proxy transport for this extension only. Uses
	// config `proxy`, else HTTP(S)_PROXY / ALL_PROXY; no-op when unset.
	await installProxyDispatcher(readConfig().proxy);
	registerWebSearchTool(pi);
	registerWebFetchTool(pi);
	registerWebCommand(pi);
}

/**
 * @bytetrue/pi-web — web_search + web_fetch for the pi coding agent.
 *
 * work the moment the package loads. Run /web to configure search; web_fetch
 * always uses the package's SSRF-safe generic transport.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readConfig } from "./config.js";
import { installProxyDispatcher } from "./proxy.js";
import { registerWebCommand, registerWebFetchTool, registerWebSearchTool } from "./tools.js";

export { createProvider } from "./providers/factory.js";
export { DEFAULT_PROVIDER_NAME, PROVIDERS } from "./providers/registry.js";
export type {
  FetchedContent,
  SearchProvider,
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

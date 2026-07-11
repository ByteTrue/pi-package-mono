/**
 * Proxy support.
 *
 * Node's global `fetch` (undici) does NOT honor HTTP_PROXY/HTTPS_PROXY/ALL_PROXY
 * by default, and a TUN-mode / system proxy often sets no env var at all. The
 * result: hosts that are only reachable through the proxy fail, while directly
 * reachable hosts work — so web_search breaks while web_fetch of other sites
 * succeeds.
 *
 * Fix: route fetches through a proxy via undici. Resolution order:
 *   1. an explicit `proxy` in the package config (most reliable — independent
 *      of how pi was launched and of TUN mode)
 *   2. HTTP(S)_PROXY / ALL_PROXY environment variables
 *
 * Provider/API fetches honor NO_PROXY. Generic web_fetch uses the installed
 * per-protocol proxy directly after its SSRF literal guard, so arbitrary target
 * hosts cannot use NO_PROXY to fall back to an unguarded direct connection.
 */

interface InstalledProxyRoutes {
	http?: string;
	https?: string;
}

let installedProxyRoutes: InstalledProxyRoutes | undefined;
let installedProxyKey: string | undefined;
let installedGlobalDispatcher: { close?: () => Promise<unknown> } | undefined;

export function getInstalledProxyUrl(protocol: "http:" | "https:" = "https:"): string | undefined {
	return protocol === "http:" ? installedProxyRoutes?.http : installedProxyRoutes?.https;
}


function detectEnvProxyRoutes(): InstalledProxyRoutes {
	const all = process.env.all_proxy?.trim() || process.env.ALL_PROXY?.trim();
	const http = process.env.http_proxy?.trim() || process.env.HTTP_PROXY?.trim() || all;
	const https = process.env.https_proxy?.trim() || process.env.HTTPS_PROXY?.trim() || http;
	return { ...(http ? { http } : {}), ...(https ? { https } : {}) };
}

function proxyKey(routes: InstalledProxyRoutes): string {
	return `${routes.http ?? ""}\n${routes.https ?? ""}`;
}

function isValidProxyUrl(raw: string): boolean {
	try {
		return ["http:", "https:", "socks:", "socks5:"].includes(new URL(raw).protocol);
	} catch {
		return false;
	}
}

/**
 * Install the proxy dispatcher. `configuredProxy` (from config.json `proxy`)
 * wins over env vars. Idempotent and non-fatal. Returns the proxy URL applied,
 * or undefined if none/disabled/unavailable.
 */
export async function installProxyDispatcher(configuredProxy?: string): Promise<string | undefined> {
	if (process.env.BYTE_PI_WEB_NO_PROXY?.trim()) {
		const undici = await loadUndici();
		if (installedProxyRoutes && undici?.setGlobalDispatcher && undici?.Agent) {
			setOwnedGlobalDispatcher(undici, new undici.Agent());
		}
		installedProxyRoutes = undefined;
		installedProxyKey = undefined;
		return undefined;
	}

	const explicit = configuredProxy?.trim();
	if (explicit && !isValidProxyUrl(explicit)) return installedProxyRoutes?.https ?? installedProxyRoutes?.http;

	const routes: InstalledProxyRoutes = explicit ? { http: explicit, https: explicit } : detectEnvProxyRoutes();
	const selected = routes.https ?? routes.http;
	if ([routes.http, routes.https].some((url) => url && !isValidProxyUrl(url))) {
		return installedProxyRoutes?.https ?? installedProxyRoutes?.http;
	}
	const undici = await loadUndici();
	if (!selected) {
		if (installedProxyRoutes && undici?.setGlobalDispatcher && undici?.Agent) {
			setOwnedGlobalDispatcher(undici, new undici.Agent());
		}
		installedProxyRoutes = undefined;
		installedProxyKey = undefined;
		return undefined;
	}

	const nextKey = proxyKey(routes);
	if (installedProxyKey === nextKey) return selected;
	if (!undici?.setGlobalDispatcher || !undici?.EnvHttpProxyAgent) {
		return installedProxyRoutes?.https ?? installedProxyRoutes?.http;
	}
	try {
		setOwnedGlobalDispatcher(
			undici,
			new undici.EnvHttpProxyAgent({
				httpProxy: routes.http,
				httpsProxy: routes.https,
				noProxy: process.env.no_proxy ?? process.env.NO_PROXY ?? "localhost,127.0.0.1,::1",
			}),
		);
		installedProxyRoutes = routes;
		installedProxyKey = nextKey;
		return selected;
	} catch {
		// The previous dispatcher is still active; keep and report its matching state.
		return installedProxyRoutes?.https ?? installedProxyRoutes?.http;
	}
}

interface UndiciProxyModule {
	setGlobalDispatcher(dispatcher: unknown): void;
	EnvHttpProxyAgent: new (options?: { httpProxy?: string; httpsProxy?: string; noProxy?: string }) => { close?: () => Promise<unknown> };
	Agent: new () => { close?: () => Promise<unknown> };
}

function setOwnedGlobalDispatcher(undici: UndiciProxyModule, dispatcher: { close?: () => Promise<unknown> }): void {
	const previous = installedGlobalDispatcher;
	undici.setGlobalDispatcher(dispatcher);
	installedGlobalDispatcher = dispatcher;
	if (previous && previous !== dispatcher) void previous.close?.().catch(() => {});
}

// Resolve undici (it backs Node's global fetch; setGlobalDispatcher on any copy
// sharing undici's global symbol affects the built-in fetch). Try a bare import
// first, then resolve relative to a guaranteed-present pi core package.
async function loadUndici(): Promise<UndiciProxyModule | undefined> {
	try {
		return (await import("undici")) as unknown as UndiciProxyModule;
	} catch {
		// fall through
	}
	try {
		const { createRequire } = await import("node:module");
		const anchor = (import.meta as { resolve?: (s: string) => string }).resolve?.(
			"@earendil-works/pi-coding-agent",
		);
		if (!anchor) return undefined;
		const require = createRequire(anchor);
		return (await import(require.resolve("undici"))) as unknown as UndiciProxyModule;
	} catch {
		return undefined;
	}
}

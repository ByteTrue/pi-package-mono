/**
 * Package-scoped proxy support.
 *
 * Resolution order:
 *   1. explicit `proxy` in package config
 *   2. HTTP(S)_PROXY / ALL_PROXY environment variables
 *
 * Provider/API fetches use a package-owned EnvHttpProxyAgent and honor
 * NO_PROXY. Generic web_fetch keeps its stricter SSRF transport in html.ts.
 * This module never changes undici's process-global dispatcher.
 */

import {
	EnvHttpProxyAgent,
	fetch as undiciFetch,
	type RequestInit as UndiciRequestInit,
} from "undici";

interface InstalledProxyRoutes {
	http?: string;
	https?: string;
}

let installedProxyRoutes: InstalledProxyRoutes | undefined;
let installedProxyKey: string | undefined;
let providerDispatcher: EnvHttpProxyAgent | undefined;

export function getInstalledProxyUrl(protocol: "http:" | "https:" = "https:"): string | undefined {
	return protocol === "http:" ? installedProxyRoutes?.http : installedProxyRoutes?.https;
}

function detectEnvProxyRoutes(): InstalledProxyRoutes {
	const all = process.env.all_proxy?.trim() || process.env.ALL_PROXY?.trim();
	const http = process.env.http_proxy?.trim() || process.env.HTTP_PROXY?.trim() || all;
	const https = process.env.https_proxy?.trim() || process.env.HTTPS_PROXY?.trim() || http;
	return { ...(http ? { http } : {}), ...(https ? { https } : {}) };
}

function proxyKey(routes: InstalledProxyRoutes, noProxy: string): string {
	return `${routes.http ?? ""}\n${routes.https ?? ""}\n${noProxy}`;
}

function isValidProxyUrl(raw: string): boolean {
	try {
		return ["http:", "https:", "socks:", "socks5:"].includes(new URL(raw).protocol);
	} catch {
		return false;
	}
}

async function clearProviderDispatcher(): Promise<void> {
	const previous = providerDispatcher;
	providerDispatcher = undefined;
	installedProxyRoutes = undefined;
	installedProxyKey = undefined;
	if (previous) await previous.close().catch(() => {});
}

/**
 * Configure the package-scoped provider dispatcher. `configuredProxy` wins
 * over env vars. Idempotent and non-fatal. Returns the selected proxy URL.
 */
export async function installProxyDispatcher(configuredProxy?: string): Promise<string | undefined> {
	if (process.env.BYTE_PI_WEB_NO_PROXY?.trim()) {
		await clearProviderDispatcher();
		return undefined;
	}

	const explicit = configuredProxy?.trim();
	if (explicit && !isValidProxyUrl(explicit)) return installedProxyRoutes?.https ?? installedProxyRoutes?.http;

	const routes: InstalledProxyRoutes = explicit ? { http: explicit, https: explicit } : detectEnvProxyRoutes();
	const selected = routes.https ?? routes.http;
	if ([routes.http, routes.https].some((url) => url && !isValidProxyUrl(url))) {
		return installedProxyRoutes?.https ?? installedProxyRoutes?.http;
	}
	if (!selected) {
		await clearProviderDispatcher();
		return undefined;
	}

	const noProxy = process.env.no_proxy ?? process.env.NO_PROXY ?? "localhost,127.0.0.1,::1";
	const nextKey = proxyKey(routes, noProxy);
	if (providerDispatcher && installedProxyKey === nextKey) return selected;

	let next: EnvHttpProxyAgent;
	try {
		next = new EnvHttpProxyAgent({ httpProxy: routes.http, httpsProxy: routes.https, noProxy });
	} catch {
		return installedProxyRoutes?.https ?? installedProxyRoutes?.http;
	}

	const previous = providerDispatcher;
	providerDispatcher = next;
	installedProxyRoutes = routes;
	installedProxyKey = nextKey;
	if (previous) await previous.close().catch(() => {});
	return selected;
}

export async function fetchWithProxy(input: string | URL, init?: RequestInit): Promise<Response> {
	if (!providerDispatcher) return globalThis.fetch(input, init);
	return (await undiciFetch(input, {
		...(init as UndiciRequestInit | undefined),
		dispatcher: providerDispatcher,
	})) as unknown as Response;
}

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
 * We install undici's EnvHttpProxyAgent (which respects NO_PROXY, so localhost
 * and local model/API endpoints bypass the proxy). An explicit config proxy
 * temporarily overrides env vars. Set BYTE_PI_WEB_NO_PROXY=1 to opt out.
 */

const PROXY_ENV_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

let installedProxy: string | undefined;
let savedProxyEnv: Record<string, string | undefined> | undefined;

function restoreSavedProxyEnv(): void {
	if (!savedProxyEnv) return;
	for (const [name, value] of Object.entries(savedProxyEnv)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	savedProxyEnv = undefined;
}

function detectEnvProxy(): string | undefined {
	for (const name of PROXY_ENV_VARS) {
		const value = process.env[name]?.trim();
		if (value) return value;
	}
	return undefined;
}

/**
 * Install the proxy dispatcher. `configuredProxy` (from config.json `proxy`)
 * wins over env vars. Idempotent and non-fatal. Returns the proxy URL applied,
 * or undefined if none/disabled/unavailable.
 */
export async function installProxyDispatcher(configuredProxy?: string): Promise<string | undefined> {
	if (process.env.BYTE_PI_WEB_NO_PROXY?.trim()) return undefined;

	const explicit = configuredProxy?.trim();
	if (explicit) {
		// Explicit package config wins over inherited shell env: /web proxy is the
		// user's per-tool routing choice, and Node's EnvHttpProxyAgent reads env.
		savedProxyEnv ??= { HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY };
		process.env.HTTP_PROXY = explicit;
		process.env.HTTPS_PROXY = explicit;
		process.env.NO_PROXY ||= "localhost,127.0.0.1,::1";
	} else {
		restoreSavedProxyEnv();
	}

	const proxy = explicit || detectEnvProxy();
	const undici = await loadUndici();
	if (!proxy) {
		if (installedProxy && undici?.setGlobalDispatcher && undici?.Agent) {
			undici.setGlobalDispatcher(new undici.Agent());
		}
		installedProxy = undefined;
		return undefined;
	}
	if (installedProxy === proxy) return proxy;

	if (!undici?.setGlobalDispatcher || !undici?.EnvHttpProxyAgent) return undefined;
	try {
		undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
		installedProxy = proxy;
		return proxy;
	} catch {
		return undefined;
	}
}

// Resolve undici (it backs Node's global fetch; setGlobalDispatcher on any copy
// sharing undici's global symbol affects the built-in fetch). Try a bare import
// first, then resolve relative to a guaranteed-present pi core package.
async function loadUndici(): Promise<
	{ setGlobalDispatcher?: (d: unknown) => void; EnvHttpProxyAgent?: new () => unknown; Agent?: new () => unknown } | undefined
> {
	try {
		return (await import("undici")) as never;
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
		return (await import(require.resolve("undici"))) as never;
	} catch {
		return undefined;
	}
}

// Bounded discover: OpenAI-compatible /models with deadlines, budgets, and command trust.
// Implements the full discoverModelIds pipeline per the design contract.

import { allCommandsTrusted, collectCommandPaths, resolveConfigValue } from "./config-resolver.js";
import { ModelSourceError } from "./model-source-error.js";

export type BoundedFetchResponse = {
	ok: boolean;
	status: number;
	// upstream statusText is deliberately unavailable to error mapping
	headers: Headers;
	body: ReadableStream<Uint8Array> | null;
};

export type BoundedFetch = (
	input: string,
	init: { method: "GET"; headers: Record<string, string>; redirect: "error"; signal: AbortSignal },
) => Promise<BoundedFetchResponse>;

export type DiscoverOptions = {
	initialProvider?: { apiKey?: string; headers?: Record<string, string> };
	providerEnv?: Record<string, string | undefined>;
	signal?: AbortSignal;
	fetchImpl?: BoundedFetch;
	runCommand?: (body: string, opts: { signal: AbortSignal; timeoutMs: number; maxStdoutBytes: number }) => Promise<string>;
};

// --- Budgets ---

const OVERALL_DEADLINE_MS = 15_000;
const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_MAX_STDOUT = 64 * 1024;
const BODY_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_IDS = 10_000;
const MAX_ID_BYTES = 1024;
const ID_MAX_BYTES_PER_CHAR = 4; // worst-case UTF-8

// --- URL validation ---

function buildModelsUrl(baseUrl: string): string {
	if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
		throw new ModelSourceError("invalid_request", "baseUrl must start with http:// or https://");
	}
	try {
		const u = new URL(baseUrl);
		if (u.username || u.password) {
			throw new ModelSourceError("invalid_request", "baseUrl must not contain credentials");
		}
		// Normalize: strip trailing slash, append /models
		let pathname = u.pathname;
		if (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
		u.pathname = pathname + "/models";
		return u.toString();
	} catch {
		throw new ModelSourceError("invalid_request", "Invalid base URL");
	}
}

// --- Body reader ---

async function readBoundedBody(
	stream: ReadableStream<Uint8Array>,
	signal: AbortSignal,
): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (signal.aborted) throw new Error("aborted");
			total += value.byteLength;
			if (total > BODY_MAX_BYTES) {
				await reader.cancel();
				throw new ModelSourceError("upstream_too_large", "Response body exceeds maximum size");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const decoder = new TextDecoder();
	let text = "";
	for (const chunk of chunks) {
		text += decoder.decode(chunk, { stream: true });
	}
	text += decoder.decode();
	return text;
}

// --- Parse /models response ---

function parseAndSortModelIds(json: unknown): string[] {
	if (!json || typeof json !== "object" || Array.isArray(json)) return [];
	const obj = json as Record<string, unknown>;
	const data = obj.data;
	if (!Array.isArray(data)) return [];

	const seen = new Set<string>();
	const ids: string[] = [];

	for (const item of data) {
		if (!item || typeof item !== "object") continue;
		const raw = (item as Record<string, unknown>).id;
		if (typeof raw !== "string") continue;
		const trimmed = raw.trim();
		if (!trimmed) continue;
		if (trimmed.length > MAX_ID_BYTES) continue; // byte count checked below
		if (new TextEncoder().encode(trimmed).length > MAX_ID_BYTES) continue;
		if (seen.has(trimmed)) continue;
		seen.add(trimmed);
		ids.push(trimmed);
		if (ids.length >= MAX_IDS) break;
	}

	// code-unit sort
	ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	return ids;
}

// --- Auth header composition ---

function hasAuthorization(headers: Record<string, string>): boolean {
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === "authorization") return true;
	}
	return false;
}

// --- Main discover function ---

export async function discoverModelIds(
	provider: { baseUrl: string; apiKey?: string; headers?: Record<string, string> },
	options: DiscoverOptions = {},
): Promise<string[]> {
	const initialProvider = options.initialProvider;
	const providerEnv = options.providerEnv ?? {};
	const processEnv: Record<string, string | undefined> = {};
	for (const [k, v] of Object.entries(process.env)) {
		processEnv[k] = v;
	}

	// Create combined signal: overall deadline + caller signal
	const overallController = new AbortController();
	const overallTimer = setTimeout(() => overallController.abort(), OVERALL_DEADLINE_MS);

	let combinedSignal = overallController.signal;
	const callerSignal = options.signal;
	if (callerSignal) {
		// Combine: abort when either fires
		const combo = new AbortController();
		const onAbort = () => combo.abort();
		overallController.signal.addEventListener("abort", onAbort);
		callerSignal.addEventListener("abort", onAbort);
		combinedSignal = combo.signal;
	}

	const runCommand = options.runCommand ?? (() => Promise.reject(new Error("No command runner available")));
	const fetchImpl = options.fetchImpl ?? ((input: string, init: any) => fetch(input, init) as any);

	try {
		// --- Preflight: check command trust ---
		if (initialProvider) {
			if (!allCommandsTrusted(provider, initialProvider)) {
				throw new ModelSourceError("credential_unresolved", "Command credentials are not trusted");
			}
		} else {
			// No initial provider: any command is untrusted
			const paths = collectCommandPaths(provider);
			if (paths.length > 0) {
				throw new ModelSourceError("credential_unresolved", "Command credentials require an initial provider for trust verification");
			}
		}

		// --- Resolve headers ---
		const requestHeaders: Record<string, string> = {};
		if (provider.headers) {
			for (const [name, value] of Object.entries(provider.headers)) {
				const result = await resolveConfigValue(value, {
					path: { kind: "header", name },
					providerEnv,
					processEnv,
					signal: combinedSignal,
					runCommand,
				});
				if (result.kind !== "resolved") {
					throw new ModelSourceError("credential_unresolved", "Failed to resolve header value");
				}
				requestHeaders[name] = result.value;
			}
		}

		// --- Resolve apiKey and compose Bearer ---
		if (!hasAuthorization(requestHeaders)) {
			if (provider.apiKey) {
				const result = await resolveConfigValue(provider.apiKey, {
					path: { kind: "apiKey" },
					providerEnv,
					processEnv,
					signal: combinedSignal,
					runCommand,
				});
				if (result.kind !== "resolved") {
					throw new ModelSourceError("credential_unresolved", "Failed to resolve API key");
				}
				if (result.value) {
					requestHeaders["Authorization"] = `Bearer ${result.value}`;
				}
			}
		}

		// --- Build URL and fetch ---
		const url = buildModelsUrl(provider.baseUrl);

		let response: BoundedFetchResponse;
		try {
			response = await fetchImpl(url, {
				method: "GET",
				headers: requestHeaders,
				redirect: "error",
				signal: combinedSignal,
			});
		} catch (err: unknown) {
			if (combinedSignal.aborted) {
				if (callerSignal?.aborted) {
					throw new ModelSourceError("aborted", "Request aborted");
				}
				throw new ModelSourceError("upstream_timeout", "Upstream request timed out");
			}
			throw new ModelSourceError("upstream_failed", "Upstream request failed");
		}

		// --- Handle non-2xx ---
		if (!response.ok) {
			// Cancel body immediately, don't read error body
			if (response.body) {
				try { await response.body.cancel(); } catch { /* ignore */ }
			}
			throw new ModelSourceError("upstream_failed", "Upstream returned an error", response.status);
		}

		// --- Read bounded body ---
		if (!response.body) {
			throw new ModelSourceError("upstream_failed", "Empty response body");
		}

		let text: string;
		try {
			text = await readBoundedBody(response.body, combinedSignal);
		} catch (err: unknown) {
			if (err instanceof ModelSourceError) throw err;
			if (combinedSignal.aborted) {
				if (callerSignal?.aborted) {
					throw new ModelSourceError("aborted", "Request aborted");
				}
				throw new ModelSourceError("upstream_timeout", "Upstream request timed out");
			}
			throw new ModelSourceError("upstream_too_large", "Response body exceeded size limit");
		}

		// --- Parse ---
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new ModelSourceError("upstream_failed", "Invalid JSON response");
		}

		return parseAndSortModelIds(parsed);
	} catch (err: unknown) {
		if (err instanceof ModelSourceError) throw err;
		if (combinedSignal.aborted) {
			if (callerSignal?.aborted) {
				throw new ModelSourceError("aborted", "Request aborted");
			}
			throw new ModelSourceError("upstream_timeout", "Upstream request timed out");
		}
		throw new ModelSourceError("upstream_failed", "Unexpected error during discovery");
	} finally {
		clearTimeout(overallTimer);
	}
}

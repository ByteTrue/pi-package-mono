import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SEARCH_RESPONSE_BODY_BYTES } from "../response-body.js";
import { createProvider, JSON_PROVIDER_SPECS } from "./factory.js";
import { PROVIDERS } from "./registry.js";
import { BingProvider } from "./bing.js";
import { ExaMcpFreeProvider } from "./exa-free.js";
import type { SearchProvider } from "./types.js";

afterEach(() => vi.unstubAllGlobals());

const providerNames = ["bocha", "tavily", "exa", "brave", "jina", "firecrawl", "searxng"] as const;

const providers: Array<[string, () => SearchProvider]> = [
	["Exa free", () => new ExaMcpFreeProvider()],
	["Bing", () => new BingProvider()],
	...providerNames.map((name) => [name, () => createProvider(name, { apiKey: "key", baseUrl: "http://searxng.invalid" })] as [string, () => SearchProvider]),
];

describe("JSON provider spec table (BYTE-6 Lean)", () => {
	// Registry and factory must stay in lockstep: every paid/keyless-with-url
	// provider in the registry needs a JSON spec, and vice versa. A missing
	// registry entry would silently break /web; a missing spec breaks search.
	it("covers exactly the registry providers that are not custom transports", () => {
		const custom = new Set(["exa-free", "bing"]);
		const expected = PROVIDERS.map((p) => p.name).filter((name) => !custom.has(name)).sort();
		expect(Object.keys(JSON_PROVIDER_SPECS).sort()).toEqual(expected);
	});
});

describe("search provider response budget", () => {
	it.each(providers)("%s rejects and cancels an oversized response", async (_name, create) => {
		let cancellations = 0;
		vi.stubGlobal("fetch", vi.fn(async () => new Response(
			new ReadableStream<Uint8Array>({ cancel: () => { cancellations++; } }),
			{ headers: { "content-length": String(MAX_SEARCH_RESPONSE_BODY_BYTES + 1) } },
		)));

		await expect(create().search("query", 3)).rejects.toThrow(/Response body exceeds/);
		expect(cancellations).toBeGreaterThan(0);
	});
	it("bounds and cancels an oversized successful Exa notification body", async () => {
		let cancelled = false;
		const fetch = vi.fn()
			.mockResolvedValueOnce(new Response(
				JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } }),
				{ headers: { "content-type": "application/json", "Mcp-Session-Id": "session-1" } },
			))
			.mockResolvedValueOnce(new Response(
				new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } }),
				{ status: 202, headers: { "content-length": String(MAX_SEARCH_RESPONSE_BODY_BYTES + 1) } },
			))
			.mockResolvedValueOnce(new Response(
				JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [] } }),
				{ headers: { "content-type": "application/json" } },
			));
		vi.stubGlobal("fetch", fetch);

		await expect(new ExaMcpFreeProvider().search("query", 3)).resolves.toEqual([]);
		expect(cancelled).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

});

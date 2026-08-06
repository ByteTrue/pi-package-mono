import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SEARCH_RESPONSE_BODY_BYTES } from "../response-body.js";
import { BingProvider } from "./bing.js";
import { BochaProvider } from "./bocha.js";
import { BraveProvider } from "./brave.js";
import { ExaMcpFreeProvider } from "./exa-free.js";
import { ExaProvider } from "./exa.js";
import { FirecrawlProvider } from "./firecrawl.js";
import { JinaProvider } from "./jina.js";
import { SearxngProvider } from "./searxng.js";
import { TavilyProvider } from "./tavily.js";
import type { SearchProvider } from "./types.js";

afterEach(() => vi.unstubAllGlobals());

const providers: Array<[string, () => SearchProvider]> = [
	["Exa free", () => new ExaMcpFreeProvider()],
	["Bing", () => new BingProvider()],
	["SearXNG", () => new SearxngProvider()],
	["Bocha", () => new BochaProvider("key")],
	["Tavily", () => new TavilyProvider("key")],
	["Exa", () => new ExaProvider("key")],
	["Brave", () => new BraveProvider("key")],
	["Jina", () => new JinaProvider("key")],
	["Firecrawl", () => new FirecrawlProvider("key")],
];

describe("search provider response budget", () => {
	it.each(providers)("%s rejects and cancels an oversized response", async (_name, createProvider) => {
		let cancellations = 0;
		vi.stubGlobal("fetch", vi.fn(async () => new Response(
			new ReadableStream<Uint8Array>({ cancel: () => { cancellations++; } }),
			{ headers: { "content-length": String(MAX_SEARCH_RESPONSE_BODY_BYTES + 1) } },
		)));

		await expect(createProvider().search("query", 3)).rejects.toThrow(/Response body exceeds/);
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

		await expect(new ExaMcpFreeProvider().search("query", 3)).resolves.toEqual({ query: "query", results: [] });
		expect(cancelled).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

});

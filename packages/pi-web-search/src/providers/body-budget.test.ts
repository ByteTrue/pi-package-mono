import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RESPONSE_BODY_BYTES } from "../response-body.js";
import { ExaProvider } from "./exa.js";
import { FirecrawlProvider } from "./firecrawl.js";
import { JinaProvider } from "./jina.js";
import { TavilyProvider } from "./tavily.js";
import type { FetchProvider } from "./types.js";

afterEach(() => vi.unstubAllGlobals());

const providers: Array<[string, () => FetchProvider]> = [
	["Tavily", () => new TavilyProvider("key")],
	["Exa", () => new ExaProvider("key")],
	["Jina", () => new JinaProvider("key")],
	["Firecrawl", () => new FirecrawlProvider("key")],
];

describe("native fetch response budget", () => {
	it.each(providers)("%s rejects and cancels an oversized API response", async (_name, createProvider) => {
		let cancelled = false;
		vi.stubGlobal("fetch", vi.fn(async () => new Response(
			new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } }),
			{ headers: { "content-length": String(MAX_RESPONSE_BODY_BYTES + 1) } },
		)));

		await expect(createProvider().fetch("https://example.com", false)).rejects.toThrow(/Response body exceeds/);
		expect(cancelled).toBe(true);
	});
});

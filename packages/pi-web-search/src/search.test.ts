import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAvailableSearchProviders, searchWithProvider } from "./search.js";

const BING = readFileSync(fileURLToPath(new URL("./providers/__fixtures__/bing.html", import.meta.url)), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("explicit search provider", () => {
	it("uses the active provider when none is specified", async () => {
		const fetch = vi.fn(async () => new Response(BING, { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		const outcome = await searchWithProvider({ provider: "bing" }, undefined, "x", 3, undefined);
		expect(outcome.backend).toBe("bing");
		expect(outcome.results.length).toBeGreaterThan(0);
	});

	it("uses only the explicitly requested provider", async () => {
		const fetch = vi.fn(async () => new Response(BING, { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		const outcome = await searchWithProvider({ provider: "brave" }, "bing", "x", 3, undefined);
		expect(outcome.backend).toBe("bing");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("does not fall back after a provider error and names explicit retry choices", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
		await expect(searchWithProvider({ provider: "bing" }, undefined, "x", 3, undefined)).rejects.toThrow(
			/bing search failed.*Retry web_search with retry_provider: exa-free/s,
		);
	});

	it("lists only providers that can currently be called", () => {
		const available = listAvailableSearchProviders({ apiKeys: { tavily: "k" } });
		expect(available).toContain("exa-free");
		expect(available).toContain("bing");
		expect(available).toContain("tavily");
		expect(available).not.toContain("exa");
		expect(available).not.toContain("searxng");
	});
});

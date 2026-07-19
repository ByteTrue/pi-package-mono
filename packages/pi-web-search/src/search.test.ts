import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSearchCandidates, searchWithFallback } from "./search.js";

const BING = readFileSync(fileURLToPath(new URL("./providers/__fixtures__/bing.html", import.meta.url)), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("buildSearchCandidates", () => {
	it("puts the active provider first", () => {
		expect(buildSearchCandidates({ provider: "exa-free" })[0]).toBe("exa-free");
		expect(buildSearchCandidates({})[0]).toBe("exa-free"); // default
	});

	it("includes keyed providers only when a key is present", () => {
		const c = buildSearchCandidates({ apiKeys: { tavily: "k" } });
		expect(c).toContain("tavily");
		expect(c).not.toContain("exa");
		// keyless ones are always present
		expect(c).toContain("bing");
		expect(c).toContain("exa-free");
	});

	it("prefers other keyed providers over keyless after the active one", () => {
		const c = buildSearchCandidates({
			provider: "firecrawl",
			apiKeys: { firecrawl: "fc", tavily: "tv", exa: "ex", jina: "jn" },
		});
		expect(c[0]).toBe("firecrawl");
		const keyed = c.slice(1, 4);
		expect(keyed).toEqual(["tavily", "exa", "jina"]);
		expect(c.slice(4)).toEqual(["exa-free", "bing"]);
	});

	it("skips base-url providers unless an explicit URL is configured", () => {
		expect(buildSearchCandidates({})).not.toContain("searxng");
		expect(buildSearchCandidates({ baseUrls: { searxng: "http://localhost:8080" } })).toContain("searxng");
	});
});

describe("searchWithFallback", () => {
	it("falls back from a failing active provider to a working one", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(BING, { status: 200 })));
		const seen: string[] = [];
		const outcome = await searchWithFallback({ provider: "brave", autoFallback: true, apiKeys: {} }, "x", 3, undefined, (p) =>
			seen.push(p.provider),
		);
		expect(outcome.backend).toBe("bing"); // brave (no key) failed → bing won
		expect(outcome.fellBack).toBe(true);
		expect(outcome.attempted.some((a) => a.startsWith("brave"))).toBe(true);
		expect(outcome.results.length).toBeGreaterThan(0);
		expect(seen[0]).toBe("brave");
	});

	it("throws only when every provider fails", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
		await expect(
			searchWithFallback({ provider: "bing", autoFallback: true }, "x", 3, undefined),
		).rejects.toThrow(/All search providers failed/);
	});

	it("does not fall back when autoFallback is false", async () => {
		// active = brave with no key → throws; with fallback off it must not try others
		vi.stubGlobal("fetch", vi.fn(async () => new Response(BING, { status: 200 })));
		await expect(
			searchWithFallback({ provider: "brave", autoFallback: false, apiKeys: {} }, "x", 3, undefined),
		).rejects.toThrow(/All search providers failed/);
	});
});

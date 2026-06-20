import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BingProvider } from "./bing.js";

// Real cn.bing.com markup captured from a live query.
const FIXTURE = readFileSync(fileURLToPath(new URL("./__fixtures__/bing.html", import.meta.url)), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("BingProvider", () => {
	it("parses b_algo results: title, direct URL, snippet", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(FIXTURE, { status: 200 })));
		const { results } = await new BingProvider().search("openai news", 5);
		expect(results.length).toBeGreaterThanOrEqual(3);
		expect(results[0]!.url).toBe("https://www.ithome.com/tags/OpenAI/");
		expect(results[0]!.title).toContain("IT之家");
		expect(results[0]!.snippet).not.toContain("<");
		expect(results[1]!.url).toBe("https://www.newsnow.com/us/Science/AI/OpenAI");
	});

	it("respects maxResults", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(FIXTURE, { status: 200 })));
		const { results } = await new BingProvider().search("x", 2);
		expect(results).toHaveLength(2);
	});

	it("decodes bing.com/ck/a redirect wrappers", async () => {
		const target = "https://example.com/page?a=b";
		const b64 = Buffer.from(target, "utf8").toString("base64url");
		const wrapped = `<ol><li class="b_algo"><h2 class=""><a href="https://www.bing.com/ck/a?!&u=a1${b64}">Wrapped</a></h2><p class="b_lineclamp2">snip</p></li></ol>`;
		vi.stubGlobal("fetch", vi.fn(async () => new Response(wrapped, { status: 200 })));
		const { results } = await new BingProvider().search("x", 1);
		expect(results[0]!.url).toBe(target);
	});

	it("returns empty (no throw) when markup has no results", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>nothing</html>", { status: 200 })));
		const { results } = await new BingProvider().search("x", 5);
		expect(results).toEqual([]);
	});
});

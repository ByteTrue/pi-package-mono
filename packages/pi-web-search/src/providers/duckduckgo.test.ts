import { afterEach, describe, expect, it, vi } from "vitest";
import { DuckDuckGoProvider } from "./duckduckgo.js";

// Real html.duckduckgo.com/html/ markup shape (the primary endpoint).
const HTML_FIXTURE = `<html><body>
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpi.dev%2Fdocs&amp;rut=abc">Pi &amp; coding agent — Today&#x27;s docs</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpi.dev%2Fdocs">Pi is a coding agent by <b>Earendil</b> Works.</a>
</div>
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fearendil&amp;rut=def">GitHub repo</a>
  <a class="result__snippet">Source code.</a>
</div>
</body></html>`;

// lite.duckduckgo.com/lite/ markup shape (the fallback endpoint).
const LITE_FIXTURE = `<table>
<tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa" class="result-link">Lite A</a></td></tr>
<tr><td class="result-snippet">snippet a</td></tr>
</table>`;

function mockResponse(body: string, status = 200): Response {
	return new Response(body, { status, headers: { "content-type": "text/html" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("DuckDuckGoProvider", () => {
	it("parses the html endpoint: decodes redirect URLs + entities, strips snippet tags", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => mockResponse(HTML_FIXTURE)));
		const { results } = await new DuckDuckGoProvider().search("earendil pi", 5);
		expect(results).toHaveLength(2);
		expect(results[0]!.url).toBe("https://pi.dev/docs");
		expect(results[0]!.title).toBe("Pi & coding agent — Today's docs"); // &amp; and &#x27; decoded
		expect(results[0]!.snippet).toContain("Earendil");
		expect(results[0]!.snippet).not.toContain("<b>");
		expect(results[1]!.url).toBe("https://github.com/earendil");
	});

	it("respects maxResults", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => mockResponse(HTML_FIXTURE)));
		const { results } = await new DuckDuckGoProvider().search("x", 1);
		expect(results).toHaveLength(1);
	});

	it("falls back to the lite endpoint when html yields nothing", async () => {
		// First two attempts (html) return a body html can't parse; third (lite) succeeds.
		let call = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				call++;
				return mockResponse(call >= 3 ? LITE_FIXTURE : "<html>no results here</html>");
			}),
		);
		const { results } = await new DuckDuckGoProvider().search("x", 5);
		expect(results).toHaveLength(1);
		expect(results[0]!.url).toBe("https://example.com/a");
	});

	it("throws an actionable rate-limit error on persistent HTTP 202", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => mockResponse("<html>blocked</html>", 202)));
		await expect(new DuckDuckGoProvider().search("x", 3)).rejects.toThrow(/rate-limit/i);
	});

	it("aborts when the signal is already aborted", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => mockResponse(HTML_FIXTURE)));
		const ac = new AbortController();
		ac.abort();
		await expect(new DuckDuckGoProvider().search("x", 3, ac.signal)).rejects.toThrow(/abort/i);
	});
});

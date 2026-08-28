import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
readConfig: vi.fn(() => ({ providers: ["tavily"] })),
searchWithProvider: vi.fn(),
}));

vi.mock("./config.js", async (importOriginal) => ({
...(await importOriginal<typeof import("./config.js")>()),
readConfig: mocks.readConfig,
}));
vi.mock("./search.js", async (importOriginal) => ({
...(await importOriginal<typeof import("./search.js")>()),
searchWithProvider: mocks.searchWithProvider,
}));

import { formatSearchResults, maskProxyUrl, needsBaseUrlPrompt, registerWebFetchTool, registerWebSearchTool } from "./tools.js";

beforeEach(() => {
mocks.readConfig.mockClear();
mocks.searchWithProvider.mockReset();
mocks.searchWithProvider.mockResolvedValue({
backend: "tavily",
results: [{ title: "One", url: "https://example.com", snippet: "Result" }],
});
});

describe("minimal tool definitions", () => {
	it("keeps behavior in descriptions/schema without prompt metadata or custom renderers", () => {
		const tools: any[] = [];
		const pi = { registerTool: (definition: any) => tools.push(definition) } as never;
		registerWebSearchTool(pi);
		registerWebFetchTool(pi);

		for (const tool of tools) {
			expect(tool.promptSnippet).toBeUndefined();
			expect(tool.promptGuidelines).toBeUndefined();
			expect(tool.renderCall).toBeUndefined();
			expect(tool.renderResult).toBeUndefined();
		}
		const search = tools.find((tool) => tool.name === "web_search");
		expect(Object.keys(search.parameters.properties)).toEqual(["query", "max_results"]);
		expect(search.parameters.required).toEqual(["query"]);
		expect(search.parameters.properties.max_results.default).toBe(5);
	});
});

describe("web_search routing contract", () => {
	it("uses active configuration and default 5 when optional fields are omitted", async () => {
		const tools: any[] = [];
		registerWebSearchTool({ registerTool: (definition: any) => tools.push(definition) } as never);
		const tool = tools[0];
		const signal = new AbortController().signal;
		await tool.execute("call", { query: "q" }, signal, undefined, {});
		expect(mocks.searchWithProvider).toHaveBeenCalledWith(
			{ providers: ["tavily"] },
			undefined,
			"q",
			5,
			signal,
			expect.any(Function),
		);
	});

	it("passes the optional result count while using the active provider", async () => {
		const tools: any[] = [];
		registerWebSearchTool({ registerTool: (definition: any) => tools.push(definition) } as never);
		const signal = new AbortController().signal;
		await tools[0].execute(
			"call",
			{ query: "q", max_results: 7 },
			signal,
			undefined,
			{},
		);
		expect(mocks.searchWithProvider).toHaveBeenCalledWith(
			{ providers: ["tavily"] },
			undefined,
			"q",
			7,
			signal,
			expect.any(Function),
		);
	});
});

describe("web_search content", () => {
	it("reports the one provider that answered", () => {
		const text = formatSearchResults(
			"OpenAI Codex CLI",
			[{ title: "Example", url: "https://example.com", snippet: "A snippet" }],
			"bing",
		);
		expect(text).toContain("Search provider: bing");
		expect(text).not.toContain("Fallback:");
	});
});

describe("proxy display", () => {
	it("masks credentials and omits proxy path/query", () => {
		expect(maskProxyUrl("http://user:secret@proxy.example:8080/path?token=x")).toBe(
			"http://****:****@proxy.example:8080",
		);
		expect(maskProxyUrl("socks5://proxy.example:1080")).toBe("socks5://proxy.example:1080");
		expect(maskProxyUrl(undefined)).toBe("(not set)");
	});
});

describe("/web provider setup", () => {
	const meta = { name: "searxng", label: "SearXNG", keyless: true, baseUrlEnvVar: "SEARXNG_URL" };

	it("prompts for SearXNG URL when neither env nor config has one", () => {
		expect(needsBaseUrlPrompt(meta, {})).toBe(true);
	});

	it("does not prompt when SearXNG URL is already configured", () => {
		expect(needsBaseUrlPrompt(meta, { baseUrls: { searxng: "http://localhost:8080" } })).toBe(false);
	});
});

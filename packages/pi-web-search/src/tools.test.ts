import { describe, expect, it } from "vitest";
import { formatSearchResults, maskProxyUrl, needsBaseUrlPrompt, registerWebFetchTool, registerWebSearchTool } from "./tools.js";

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
		expect(search.parameters.properties.provider).toBeDefined();
	});
});

describe("web_search content", () => {
	it("reports the one provider that answered", () => {
		const text = formatSearchResults(
			"OpenAI Codex CLI",
			[{ title: "Example", url: "https://example.com", snippet: "A snippet" }],
			{ backend: "bing" },
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

import { describe, expect, it } from "vitest";
import { formatSearchResults, needsBaseUrlPrompt, registerWebSearchTool } from "./tools.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as never;

describe("web_search TUI rendering", () => {
	it("shows provider in collapsed view and results when expanded", () => {
		let tool: any;
		registerWebSearchTool({ registerTool: (definition: any) => (tool = definition) } as never);

		const result = {
			content: [{ type: "text", text: "ignored" }],
			details: {
				backend: "exa-free",
				resultCount: 1,
				query: "OpenAI Codex CLI",
				results: [{ title: "Example", url: "https://example.com", snippet: "A snippet" }],
			},
		};

		expect(tool.renderResult(result, { expanded: false }, theme, {}).render(120).join("\n").trimEnd()).toBe(
			"✓ 1 result via exa-free for \"OpenAI Codex CLI\"",
		);
		expect(tool.renderResult(result, { expanded: true }, theme, {}).render(120).join("\n")).toContain(
			"OpenAI Codex CLI",
		);
		expect(tool.renderResult(result, { expanded: true }, theme, {}).render(120).join("\n")).toContain(
			"https://example.com",
		);
	});
});

describe("web_search tool content", () => {
	it("tells the agent which provider won and whether fallback happened", () => {
		const text = formatSearchResults(
			"OpenAI Codex CLI",
			[{ title: "Example", url: "https://example.com", snippet: "A snippet" }],
			{ backend: "bing", fellBackFrom: ["exa-free: 0 results"] },
		);

		expect(text).toContain("Search provider: bing");
		expect(text).toContain("Fallback: exa-free: 0 results");
	});
});

describe("/web provider setup", () => {
	it("prompts for SearXNG URL when neither env nor config has one", () => {
		expect(
			needsBaseUrlPrompt(
				{ name: "searxng", label: "SearXNG", roles: ["search"], keyless: true, baseUrlEnvVar: "SEARXNG_URL" },
				{},
			),
		).toBe(true);
	});

	it("does not prompt when SearXNG URL is already configured", () => {
		expect(
			needsBaseUrlPrompt(
				{ name: "searxng", label: "SearXNG", roles: ["search"], keyless: true, baseUrlEnvVar: "SEARXNG_URL" },
				{ baseUrls: { searxng: "http://localhost:8080" } },
			),
		).toBe(false);
	});
});

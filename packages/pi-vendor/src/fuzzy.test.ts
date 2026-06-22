import { describe, expect, it } from "vitest";

import { fuzzyFilter, fuzzyMatch } from "./fuzzy.js";

describe("fuzzy matching", () => {
	it("matches when all query characters appear in order", () => {
		expect(fuzzyMatch("co", "claude-opus")).toEqual({ matches: true, score: expect.any(Number) });
		expect(fuzzyMatch("co48", "claude-opus-4-8")).toEqual({ matches: true, score: expect.any(Number) });
		expect(fuzzyMatch("gpt4o", "gpt-4o")).toEqual({ matches: true, score: expect.any(Number) });
	});

	it("does not match when characters are out of order", () => {
		expect(fuzzyMatch("oc", "claude-opus").matches).toBe(false);
		expect(fuzzyMatch("xyz", "claude-opus").matches).toBe(false);
	});

	it("matches empty query against anything", () => {
		expect(fuzzyMatch("", "anything").matches).toBe(true);
		expect(fuzzyMatch("", "").matches).toBe(true);
	});

	it("does not match if query is longer than text", () => {
		expect(fuzzyMatch("abcdef", "abc").matches).toBe(false);
	});

	it("gives better score for exact match", () => {
		const exactMatch = fuzzyMatch("gpt-4o", "gpt-4o");
		const partialMatch = fuzzyMatch("gpt4o", "gpt-4o");
		expect(exactMatch.score).toBeLessThan(partialMatch.score);
	});

	it("gives better score for consecutive matches", () => {
		const consecutive = fuzzyMatch("abc", "abcdef");
		const scattered = fuzzyMatch("abc", "axbxc");
		expect(consecutive.score).toBeLessThan(scattered.score);
	});
});

describe("fuzzy filter", () => {
	const items = [
		{ id: "claude-opus-4-8", provider: "anthropic" },
		{ id: "claude-sonnet-4-6", provider: "anthropic" },
		{ id: "gpt-4o", provider: "openai" },
		{ id: "gpt-4o-mini", provider: "openai" },
		{ id: "gemini-2.5-pro", provider: "google" },
	];

	it("returns all items for empty query", () => {
		expect(fuzzyFilter(items, "", (item) => item.id)).toEqual(items);
	});

	it("filters and sorts by fuzzy match", () => {
		const result = fuzzyFilter(items, "claude", (item) => item.id);
		expect(result).toHaveLength(2);
		expect(result[0]?.id).toBe("claude-opus-4-8");
		expect(result[1]?.id).toBe("claude-sonnet-4-6");
	});

	it("matches with abbreviated query", () => {
		const result = fuzzyFilter(items, "co48", (item) => `${item.id} ${item.provider}`);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("claude-opus-4-8");
	});

	it("matches multiple tokens (space-separated)", () => {
		const result = fuzzyFilter(items, "gpt openai", (item) => `${item.id} ${item.provider}`);
		expect(result).toHaveLength(2);
		expect(result.map((r) => r.id)).toContain("gpt-4o");
		expect(result.map((r) => r.id)).toContain("gpt-4o-mini");
	});

	it("returns empty array when no matches", () => {
		const result = fuzzyFilter(items, "xyz", (item) => item.id);
		expect(result).toEqual([]);
	});
});

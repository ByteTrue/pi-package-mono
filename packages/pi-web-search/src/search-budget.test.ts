import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	primarySearch: vi.fn(),
	fallbackSearch: vi.fn(),
}));

vi.mock("./providers/factory.js", () => ({
	createProvider: (name: string) => ({
		name,
		label: name,
		search: name === "exa-free" ? mocks.primarySearch : mocks.fallbackSearch,
	}),
}));

import {
	MAX_SEARCH_ERROR_BYTES,
	MAX_SEARCH_RESULT_BYTES,
	normalizeSearchResults,
	searchWithFallback,
} from "./search.js";

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("provider attempt timeout", () => {
	it("falls back when a provider ignores the timeout signal", async () => {
		let primarySignal: AbortSignal | undefined;
		mocks.primarySearch.mockImplementation((_query, _max, signal) => {
			primarySignal = signal;
			return new Promise(() => {});
		});
		mocks.fallbackSearch.mockResolvedValue({
			query: "q",
			results: [{ title: "Fallback", url: "https://example.com", snippet: "ok" }],
		});

		const outcome = await searchWithFallback({}, "q", 5, undefined, undefined, 5);

		expect(primarySignal?.aborted).toBe(true);
		expect(outcome.backend).toBe("bing");
		expect(outcome.attempted[0]).toMatch(/exa-free: timed out after 5ms/);
	});

	it("external abort stops the whole search without fallback", async () => {
		mocks.primarySearch.mockImplementation(() => new Promise(() => {}));
		const controller = new AbortController();
		const search = searchWithFallback({}, "q", 5, controller.signal, undefined, 1_000);
		controller.abort(new Error("stop"));

		await expect(search).rejects.toThrow("stop");
		expect(mocks.fallbackSearch).not.toHaveBeenCalled();
	});

	it("external abort wins when provider resolves in the same turn", async () => {
		let resolvePrimary!: (value: { query: string; results: Array<{ title: string; url: string; snippet: string }> }) => void;
		mocks.primarySearch.mockImplementation(() => new Promise((resolve) => { resolvePrimary = resolve; }));
		const controller = new AbortController();
		const search = searchWithFallback({}, "q", 5, controller.signal, undefined, 1_000);

		resolvePrimary({ query: "q", results: [{ title: "late", url: "https://example.com", snippet: "late" }] });
		controller.abort(new Error("stop"));

		await expect(search).rejects.toThrow("stop");
		expect(mocks.fallbackSearch).not.toHaveBeenCalled();
	});
});

describe("search result budget", () => {
	it("caps UTF-8 fields and the aggregate result bytes", () => {
		const input = Array.from({ length: 10 }, () => ({
			title: "🙂".repeat(300),
			url: `https://example.com/${"u".repeat(5_000)}`,
			snippet: "s".repeat(3_000),
		}));

		const results = normalizeSearchResults(input, 10);
		const totalBytes = results.reduce((total, result) => total + byteLength(result.title) + byteLength(result.url) + byteLength(result.snippet), 0);

		expect(results).toHaveLength(10);
		expect(byteLength(results[0]!.title)).toBeLessThanOrEqual(512);
		expect(results[0]!.title).not.toContain("�");
		expect(results[0]!.title).toBe("🙂".repeat(128));
		expect(byteLength(results[0]!.url)).toBeLessThanOrEqual(4_096);
		expect(byteLength(results[0]!.snippet)).toBeLessThanOrEqual(2_048);
		expect(totalBytes).toBeLessThanOrEqual(MAX_SEARCH_RESULT_BYTES);
		expect(totalBytes).toBe(MAX_SEARCH_RESULT_BYTES);
		expect(byteLength(results.at(-1)!.snippet)).toBe(1_024);
		expect(input[0]!.title.length).toBeGreaterThan(results[0]!.title.length);
	});

	it("caps provider error text recorded in attempted", async () => {
		mocks.primarySearch.mockRejectedValue(new Error("x".repeat(2_000)));
		mocks.fallbackSearch.mockResolvedValue({ query: "q", results: [] });

		const outcome = await searchWithFallback({}, "q", 5, undefined);
		const message = outcome.attempted[0]!.slice("exa-free: ".length);

		expect(byteLength(message)).toBeLessThanOrEqual(MAX_SEARCH_ERROR_BYTES);
	});
});

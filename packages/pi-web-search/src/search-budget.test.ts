import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	primarySearch: vi.fn(),
	otherSearch: vi.fn(),
}));
vi.mock("./providers/factory.js", () => ({
	createProvider: (name: string) => {
		if (name === "broken") throw new Error("unknown provider");
		return {
			name,
			label: name,
			search: name === "exa-free" ? mocks.primarySearch : mocks.otherSearch,
		};
	},
}));

import {
	MAX_SEARCH_ERROR_BYTES,
	MAX_SEARCH_RESULT_BYTES,
	normalizeSearchResults,
	searchWithProvider,
} from "./search.js";

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

beforeEach(() => vi.clearAllMocks());

describe("provider attempt timeout", () => {
	it("aborts and rejects when the one provider ignores its timeout signal", async () => {
		let providerSignal: AbortSignal | undefined;
		mocks.primarySearch.mockImplementation((_query, _max, signal) => {
			providerSignal = signal;
			return new Promise(() => {});
		});

		await expect(searchWithProvider({}, undefined, "q", 5, undefined, undefined, 5)).rejects.toThrow(
			/timed out after 5ms/,
		);
		expect(providerSignal?.aborted).toBe(true);
		expect(mocks.otherSearch).not.toHaveBeenCalled();
	});

	it("external abort stops the search", async () => {
		mocks.primarySearch.mockImplementation(() => new Promise(() => {}));
		const controller = new AbortController();
		const search = searchWithProvider({ providers: ["exa-free", "bing"] }, undefined, "q", 5, controller.signal, undefined, 1_000);
		controller.abort(new Error("stop"));
		await expect(search).rejects.toThrow("stop");
		expect(mocks.otherSearch).not.toHaveBeenCalled();
	});

	it("external abort wins when the provider resolves in the same turn", async () => {
		let resolvePrimary!: (value: { query: string; results: Array<{ title: string; url: string; snippet: string }> }) => void;
		mocks.primarySearch.mockImplementation(() => new Promise((resolve) => { resolvePrimary = resolve; }));
		const controller = new AbortController();
		const search = searchWithProvider({}, undefined, "q", 5, controller.signal, undefined, 1_000);
		resolvePrimary({ query: "q", results: [{ title: "late", url: "https://example.com", snippet: "late" }] });
		controller.abort(new Error("stop"));
		await expect(search).rejects.toThrow("stop");
	});
});

describe("provider fallback chain", () => {
	it("tries the next provider after a failure", async () => {
		mocks.primarySearch.mockRejectedValue(new Error("primary down"));
		mocks.otherSearch.mockResolvedValue([{ title: "fallback", url: "https://example.com", snippet: "ok" }]);

		const outcome = await searchWithProvider({ providers: ["exa-free", "bing"] }, undefined, "q", 5, undefined);

		expect(outcome.backend).toBe("bing");
		expect(outcome.attemptedProviders).toEqual(["exa-free", "bing"]);
		expect(mocks.primarySearch).toHaveBeenCalledOnce();
		expect(mocks.otherSearch).toHaveBeenCalledOnce();
	});

	it("tries the next provider after a timeout", async () => {
		mocks.primarySearch.mockImplementation(() => new Promise(() => {}));
		mocks.otherSearch.mockResolvedValue([]);

		const outcome = await searchWithProvider({ providers: ["exa-free", "bing"] }, undefined, "q", 5, undefined, undefined, 5);

		expect(outcome.backend).toBe("bing");
		expect(outcome.attemptedProviders).toEqual(["exa-free", "bing"]);
	});

	it("skips a provider that cannot be constructed", async () => {
		mocks.otherSearch.mockResolvedValue([{ title: "fallback", url: "https://example.com", snippet: "ok" }]);

		const outcome = await searchWithProvider({ providers: ["broken", "bing"] }, undefined, "q", 5, undefined);

		expect(outcome.backend).toBe("bing");
		expect(outcome.attemptedProviders).toEqual(["broken", "bing"]);
		expect(mocks.otherSearch).toHaveBeenCalledOnce();
	});

	it("returns empty results without trying the next provider", async () => {
		mocks.primarySearch.mockResolvedValue([]);
		mocks.otherSearch.mockResolvedValue([{ title: "fallback", url: "https://example.com", snippet: "ok" }]);

		const outcome = await searchWithProvider({ providers: ["exa-free", "bing"] }, undefined, "q", 5, undefined);
		expect(outcome.backend).toBe("exa-free");
		expect(outcome.results).toEqual([]);
		expect(mocks.otherSearch).not.toHaveBeenCalled();
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
		const totalBytes = results.reduce(
			(total, result) => total + byteLength(result.title) + byteLength(result.url) + byteLength(result.snippet),
			0,
		);
		expect(results).toHaveLength(10);
		expect(byteLength(results[0]!.title)).toBeLessThanOrEqual(512);
		expect(results[0]!.title).toBe("🙂".repeat(128));
		expect(totalBytes).toBe(MAX_SEARCH_RESULT_BYTES);
		expect(byteLength(results.at(-1)!.snippet)).toBe(1_024);
	});

	it("caps provider error text before returning it", async () => {
		mocks.primarySearch.mockRejectedValue(new Error("x".repeat(2_000)));
		let message = "";
		try {
			await searchWithProvider({}, undefined, "q", 5, undefined);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		const providerPart = message.slice("exa-free search failed: ".length).split(". Other available providers")[0]!;
		expect(byteLength(providerPart)).toBeLessThanOrEqual(MAX_SEARCH_ERROR_BYTES);
	});
});

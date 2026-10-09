import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWithProvider } from "./search.js";

const BING = readFileSync(fileURLToPath(new URL("./providers/__fixtures__/bing.html", import.meta.url)), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("configured search provider chain", () => {
	it("uses the active provider when none is specified", async () => {
		const fetch = vi.fn(async () => new Response(BING, { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		const outcome = await searchWithProvider({ providers: ["bing"] }, undefined, "x", 3, undefined);
		expect(outcome.backend).toBe("bing");
		expect(outcome.attemptedProviders).toEqual(["bing"]);
		expect(outcome.results.length).toBeGreaterThan(0);
	});

	it("keeps explicit provider calls to one provider", async () => {
		const fetch = vi.fn(async () => new Response(BING, { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		const outcome = await searchWithProvider({ providers: ["brave"] }, "bing", "x", 3, undefined);
		expect(outcome.backend).toBe("bing");
		expect(outcome.attemptedProviders).toEqual(["bing"]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("does not hide the configured chain on failure", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
		await expect(searchWithProvider({ providers: ["bing"] }, undefined, "x", 3, undefined)).rejects.toThrow(
			/All configured search providers failed: bing: Bing search failed: network down/s,
		);
	});
});

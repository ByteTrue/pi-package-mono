import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveProviderName, resolveApiKey } from "./config.js";

afterEach(() => vi.unstubAllEnvs());

describe("getActiveProviderName", () => {
	it("defaults to bing when unset", () => {
		expect(getActiveProviderName({})).toBe("bing");
	});
	it("uses the configured provider", () => {
		expect(getActiveProviderName({ provider: "tavily" })).toBe("tavily");
	});
});

describe("resolveApiKey", () => {
	it("prefers the env var over config", () => {
		vi.stubEnv("TAVILY_API_KEY", "from-env");
		expect(resolveApiKey("tavily", { apiKeys: { tavily: "from-config" } })).toBe("from-env");
	});
	it("falls back to config when env is unset", () => {
		vi.stubEnv("TAVILY_API_KEY", "");
		expect(resolveApiKey("tavily", { apiKeys: { tavily: "from-config" } })).toBe("from-config");
	});
	it("returns undefined for a keyless provider", () => {
		expect(resolveApiKey("duckduckgo", {})).toBeUndefined();
	});
	it("returns undefined for an unknown provider", () => {
		expect(resolveApiKey("nope", { apiKeys: { nope: "x" } })).toBeUndefined();
	});
});

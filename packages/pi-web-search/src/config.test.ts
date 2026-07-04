import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveProviderName, resolveApiKey, resolveBaseUrl } from "./config.js";

afterEach(() => vi.unstubAllEnvs());

describe("getActiveProviderName", () => {
	it("defaults to exa-free when unset", () => {
		expect(getActiveProviderName({})).toBe("exa-free");
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
		expect(resolveApiKey("exa-free", {})).toBeUndefined();
	});
	it("returns undefined for an unknown provider", () => {
		expect(resolveApiKey("nope", { apiKeys: { nope: "x" } })).toBeUndefined();
	});
});

	describe("resolveBaseUrl", () => {
		it("prefers the env var over config", () => {
			vi.stubEnv("SEARXNG_URL", "http://env-host:8080");
			expect(resolveBaseUrl("searxng", { baseUrls: { searxng: "http://config-host:8080" } })).toBe("http://env-host:8080");
		});
		it("falls back to config when env is unset", () => {
			vi.stubEnv("SEARXNG_URL", "");
			expect(resolveBaseUrl("searxng", { baseUrls: { searxng: "http://config-host:8080" } })).toBe("http://config-host:8080");
		});
		it("falls back to defaultBaseUrl when neither env nor config is set", () => {
			vi.stubEnv("SEARXNG_URL", "");
			expect(resolveBaseUrl("searxng", {})).toBe("http://localhost:8080");
		});
		it("returns undefined for a provider without baseUrlEnvVar or defaultBaseUrl", () => {
			expect(resolveBaseUrl("bing", {})).toBeUndefined();
		});
	});

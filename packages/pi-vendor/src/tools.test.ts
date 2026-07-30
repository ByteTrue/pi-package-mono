import { describe, expect, it, vi } from "vitest";
import { registerVendorTools, type VendorToolDependencies } from "./tools.js";

function setup(overrides: Partial<VendorToolDependencies> = {}) {
	const tools = new Map<string, any>();
	const deps: VendorToolDependencies = {
		searchCatalog: vi.fn(async () => []),
		discover: vi.fn(async () => []),
		readModels: vi.fn(() => ({ providers: {} })),
		runCommand: vi.fn(async () => ""),
		...overrides,
	};
	registerVendorTools({ registerTool: (tool: any) => tools.set(tool.name, tool) } as never, deps);
	return { tools, deps };
}

function context(registry: { refresh?: () => unknown; getError?: () => string | undefined } = {}) {
	return {
		modelRegistry: {
			refresh: registry.refresh ?? vi.fn(),
			getError: registry.getError ?? vi.fn(() => undefined),
		},
	};
}

describe("vendor read-only tools", () => {
	it("registers exactly the three AI verbs", () => {
		const { tools } = setup();
		expect([...tools.keys()]).toEqual(["vendor_catalog_search", "vendor_validate", "vendor_discover"]);
	});

	it("catalog search returns closed templates from the injected catalog", async () => {
		const result = [{ provider: "anthropic", modelId: "claude-opus-4-5", model: { id: "claude-opus-4-5", contextWindow: 200000 } }];
		const searchCatalog = vi.fn(async () => result);
		const { tools } = setup({ searchCatalog: searchCatalog as never });

		const output = await tools.get("vendor_catalog_search").execute("id", { query: "opus", limit: 12 });

		expect(searchCatalog).toHaveBeenCalledWith("opus", 12);
		expect(JSON.parse(output.content[0].text)).toEqual({ query: "opus", count: 1, results: result });
	});

	it("validates with await refresh and redacts an apiKey from errors", async () => {
		let refreshed = false;
		const { tools } = setup({
			readModels: () => ({ providers: { relay: { apiKey: "sk-secret" } } }),
		});
		const ctx = context({
			refresh: async () => { refreshed = true; },
			getError: () => refreshed ? "bad value sk-secret" : "stale result",
		});

		const output = await tools.get("vendor_validate").execute("id", {}, undefined, undefined, ctx);

		expect(JSON.parse(output.content[0].text)).toEqual({ valid: false, error: "bad value [REDACTED]" });
	});

	it("discovers by provider key without returning credentials", async () => {
		const discover = vi.fn(async () => ["model-a", "model-b"]);
		const { tools } = setup({
			readModels: () => ({
				providers: { relay: { baseUrl: "https://relay.test/v1", apiKey: "sk-secret", headers: { "X-Key": "$KEY" } } },
			}),
			discover: discover as never,
		});

		const output = await tools.get("vendor_discover").execute("id", { providerKey: "relay" }, new AbortController().signal);
		const parsed = JSON.parse(output.content[0].text);

		expect(parsed).toEqual({ providerKey: "relay", count: 2, modelIds: ["model-a", "model-b"] });
		expect(output.content[0].text).not.toContain("sk-secret");
		expect(discover).toHaveBeenCalledWith(
			{ baseUrl: "https://relay.test/v1", apiKey: "sk-secret", headers: { "X-Key": "$KEY" } },
			expect.objectContaining({ initialProvider: { apiKey: "sk-secret", headers: { "X-Key": "$KEY" } } }),
		);
	});
});

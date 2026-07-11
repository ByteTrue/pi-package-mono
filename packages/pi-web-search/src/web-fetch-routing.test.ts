import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	genericFetch: vi.fn(),
	nativeFetch: vi.fn(),
}));

vi.mock("./html.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./html.js")>()),
	fetchViaGenericHtml: mocks.genericFetch,
}));

vi.mock("./providers/factory.js", () => ({
	createProvider: () => ({
		name: "native-test",
		label: "Native test",
		search: vi.fn(),
		fetch: mocks.nativeFetch,
	}),
}));

import { registerWebFetchTool } from "./tools.js";

function captureTool(): any {
	let tool: any;
	registerWebFetchTool({ registerTool: (definition: any) => { tool = definition; } } as never);
	return tool;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.genericFetch.mockResolvedValue({ text: "<html>raw</html>", contentType: "text/html" });
	mocks.nativeFetch.mockResolvedValue({ text: "native text", contentType: "text/plain" });
});

describe("web_fetch routing", () => {
	it("raw=true always uses the generic transport", async () => {
		const result = await captureTool().execute("call", { url: "https://example.com", raw: true }, undefined, undefined, {});

		expect(mocks.genericFetch).toHaveBeenCalledWith("https://example.com", true, undefined);
		expect(mocks.nativeFetch).not.toHaveBeenCalled();
		expect(result.content[0].text).toContain("<html>raw</html>");
	});

	it("raw=false keeps native fetch as the first choice", async () => {
		const result = await captureTool().execute("call", { url: "https://example.com", raw: false }, undefined, undefined, {});

		expect(mocks.nativeFetch).toHaveBeenCalledWith("https://example.com", false, undefined);
		expect(mocks.genericFetch).not.toHaveBeenCalled();
		expect(result.content[0].text).toContain("native text");
	});

	it("raw=false still falls back to generic when native fetch fails", async () => {
		mocks.nativeFetch.mockRejectedValueOnce(new Error("native down"));

		await captureTool().execute("call", { url: "https://example.com" }, undefined, undefined, {});
		expect(mocks.nativeFetch).toHaveBeenCalledWith("https://example.com", false, undefined);

		expect(mocks.genericFetch).toHaveBeenCalledWith("https://example.com", false, undefined);
		expect(mocks.nativeFetch.mock.invocationCallOrder[0]).toBeLessThan(mocks.genericFetch.mock.invocationCallOrder[0]!);
	});
});

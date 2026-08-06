import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ genericFetch: vi.fn() }));

vi.mock("./html.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./html.js")>()),
	fetchViaGenericHtml: mocks.genericFetch,
}));

import { registerWebFetchTool } from "./tools.js";

function captureTool(): any {
	let tool: any;
	registerWebFetchTool({ registerTool: (definition: any) => { tool = definition; } } as never);
	return tool;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.genericFetch.mockResolvedValue({ text: "direct text", contentType: "text/plain" });
});

describe("web_fetch routing", () => {
	it.each([true, false, undefined])("raw=%s always uses the SSRF-safe generic transport", async (raw) => {
		const params = raw === undefined ? { url: "https://example.com" } : { url: "https://example.com", raw };
		const result = await captureTool().execute("call", params, undefined, undefined, {});
		expect(mocks.genericFetch).toHaveBeenCalledOnce();
		expect(mocks.genericFetch).toHaveBeenCalledWith("https://example.com", raw ?? false, undefined);
		expect(result.content[0].text).toContain("direct text");
	});
});

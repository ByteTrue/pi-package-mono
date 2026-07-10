import { afterEach, describe, expect, it, vi } from "vitest";
import { extractTitle, fetchUrlOrThrow, htmlToText, parseAndAssertHttpUrl } from "./html.js";

describe("htmlToText", () => {
	it("drops script/style and converts block tags to newlines", () => {
		const out = htmlToText("<p>Hello</p><script>bad()</script><style>x{}</style><p>World</p>");
		expect(out).not.toContain("bad()");
		expect(out.replace(/\s+/g, " ").trim()).toBe("Hello World");
	});

	it("decodes named, decimal, and hex entities", () => {
		expect(htmlToText("<p>A &amp; B &lt;c&gt;</p>").trim()).toBe("A & B <c>");
		expect(htmlToText("<p>Today&#x27;s &#38; tomorrow&#39;s</p>").trim()).toBe("Today's & tomorrow's");
	});
});

describe("extractTitle", () => {
	it("pulls the <title>", () => {
		expect(extractTitle("<html><head><title>Hi there</title></head></html>")).toBe("Hi there");
	});
	it("returns undefined when absent", () => {
		expect(extractTitle("<html></html>")).toBeUndefined();
	});
});

describe("parseAndAssertHttpUrl (SSRF guard)", () => {
	it("accepts public http/https", () => {
		expect(parseAndAssertHttpUrl("https://pi.dev/x").hostname).toBe("pi.dev");
	});

	it.each([
		"http://169.254.169.254/latest/meta-data",
		"http://localhost:8080",
		"http://127.0.0.1",
		"http://10.0.0.1",
		"http://192.168.1.1",
		"http://172.16.0.1",
	])("rejects private/loopback %s", (url) => {
		expect(() => parseAndAssertHttpUrl(url)).toThrow(/private\/loopback/);
	});

	it("rejects non-http protocols", () => {
		expect(() => parseAndAssertHttpUrl("ftp://example.com")).toThrow(/protocol/);
	});

	it("rejects malformed URLs", () => {
		expect(() => parseAndAssertHttpUrl("not a url")).toThrow(/Invalid URL/);
	});
});

describe("fetchUrlOrThrow (redirect SSRF)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("follows a public redirect and returns the final response", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, { status: 302, headers: { Location: "https://example.com/final" } }),
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }));
		vi.stubGlobal("fetch", fetchMock);

		const res = await fetchUrlOrThrow("https://example.com/start", undefined);
		expect(await res.text()).toBe("ok");
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
	});

	it("rejects redirect into a private host", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data" } }),
			),
		);
		await expect(fetchUrlOrThrow("https://evil.example/open", undefined)).rejects.toThrow(/private\/loopback/);
	});

	it("rejects relative redirect that resolves to loopback", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/secret" } })),
		);
		await expect(fetchUrlOrThrow("https://public.example/x", undefined)).rejects.toThrow(/private\/loopback/);
	});
});

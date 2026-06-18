import { describe, expect, it } from "vitest";
import { extractTitle, htmlToText, parseAndAssertHttpUrl } from "./html.js";

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

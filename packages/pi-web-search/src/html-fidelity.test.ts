import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTextContentType, extractTitle, fetchViaGenericHtml, htmlToText } from "./html.js";
import { charsetFromContentType, readResponseText } from "./response-body.js";

const fetchMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("undici", async (importOriginal) => {
	const actual = await importOriginal<typeof import("undici")>();
	return { ...actual, fetch: fetchMock.fn };
});
vi.mock("node:dns/promises", () => ({
	lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

afterEach(() => vi.clearAllMocks());

describe("content-type whitelist (BYTE-6 #12)", () => {
	it("rejects binary documents instead of emitting mojibake", () => {
		expect(() => assertTextContentType("application/pdf")).toThrow(/Unsupported content type/);
		expect(() => assertTextContentType("application/zip")).toThrow(/Unsupported content type/);
		expect(() => assertTextContentType("application/octet-stream")).toThrow(/Unsupported content type/);
		expect(() => assertTextContentType("")).toThrow(/Unsupported content type/);
	});

	it("still accepts the common text surfaces", () => {
		for (const type of ["text/html; charset=utf-8", "text/plain", "application/json", "application/xml", "application/xhtml+xml", "text/markdown"]) {
			expect(() => assertTextContentType(type)).not.toThrow();
		}
	});

	it("refuses to fetch a PDF URL end to end", async () => {
		fetchMock.fn.mockResolvedValue(new Response("%PDF-1.7 fake", { headers: { "content-type": "application/pdf" } }));
		await expect(fetchViaGenericHtml("https://public.example/doc.pdf", false)).rejects.toThrow(/Unsupported content type/);
	});
});

describe("charset decoding (BYTE-6 #12)", () => {
	it("parses the charset parameter with a safe fallback", () => {
		expect(charsetFromContentType("text/html; charset=GBK")).toBe("gbk");
		expect(charsetFromContentType('text/html; charset="gb18030"')).toBe("gb18030");
		expect(charsetFromContentType("text/html")).toBe("utf-8");
		expect(charsetFromContentType("text/html; charset=made-up")).toBe("utf-8");
	});

	it("decodes a GBK page into readable Chinese instead of mojibake", async () => {
		// "中文搜索" encoded as GBK bytes.
		const gbkBytes = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0xcb, 0xd1, 0xcb, 0xf7]);
		fetchMock.fn.mockResolvedValue(new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(gbkBytes);
					controller.close();
				},
			}),
			{ headers: { "content-type": "text/html; charset=gbk" } },
		));
		const result = await fetchViaGenericHtml("https://public.example/gbk", false);
		expect(result.text).toContain("中文搜索");
	});

	it("readResponseText still honors an explicit charset override", async () => {
		const bytes = new TextEncoder().encode("héllo");
		const response = new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes);
				controller.close();
			},
		}), { headers: { "content-type": "text/plain" } });
		await expect(readResponseText(response, 1000, "utf-8")).resolves.toBe("héllo");
	});
});

describe("HTML extraction fixes (BYTE-6 #12)", () => {
	it("decodes entities in titles", () => {
		expect(extractTitle("<title>A &amp; B &#39;quoted&#39;</title>")).toBe("A & B 'quoted'");
	});

	it("does not double-decode escaped entities", () => {
		// "&amp;lt;" is the literal text "&lt;" — one decode pass keeps it there
		// instead of collapsing into "<".
		expect(htmlToText("<p>x &amp;lt; y</p>").trim()).toBe("x &lt; y");
		expect(htmlToText("<p>&amp;#60; tag</p>").trim()).toBe("&#60; tag");
	});

	it("keeps tags intact when attribute values contain '>'", () => {
		const html = '<p data-x="a>b">visible</p><span class="x>y">also</span>';
		const out = htmlToText(html);
		expect(out).toContain("visible");
		expect(out).toContain("also");
		expect(out).not.toContain("data-x");
	});

	it("does not leak the body of an unterminated script", () => {
		const out = htmlToText("<p>before</p><script>alert(document.cookie)");
		expect(out).toContain("before");
		expect(out).not.toContain("alert");
		expect(out).not.toContain("cookie");
	});

	it("strips HTML comments including conditional ones", () => {
		const out = htmlToText("<!-- hidden --><p>shown</p><!--[if IE]><p>legacy</p><![endif]-->");
		expect(out).toBe("shown");
	});
});

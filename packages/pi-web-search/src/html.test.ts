import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAgent } from "undici";
import { createSsrfSafeDirectAgent, extractTitle, fetchUrlOrThrow, htmlToText, parseAndAssertHttpUrl } from "./html.js";

const resolvePublic = async () => [{ address: "93.184.216.34", family: 4 as const }];

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
		expect(parseAndAssertHttpUrl("http://[64:ff9b::808:808]/").hostname).toBe("[64:ff9b::808:808]");
		expect(parseAndAssertHttpUrl("http://192.0.0.9/").hostname).toBe("192.0.0.9");
		expect(parseAndAssertHttpUrl("http://[2001:20::1]/").hostname).toBe("[2001:20::1]");
		expect(parseAndAssertHttpUrl("http://[2001:30::1]/").hostname).toBe("[2001:30::1]");
	});

	it.each([
		"http://169.254.169.254/latest/meta-data",
		"http://localhost:8080",
		"http://localhost./",
		"http://[::ffff:127.0.0.1]/",
		"http://[::ffff:8.8.8.8]/",
		"http://[64:ff9b::7f00:1]/",
		"http://[2001:10::1]/",
		"http://[3fff::1]/",
		"http://192.88.99.2/",
		"http://[100:0:0:1::1]/",
		"http://[2001:5::1]/",
		"http://[5f00::1]/",
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

const closeAfterTest: Array<() => Promise<unknown>> = [];

function createMockAgent(): MockAgent {
	const agent = new MockAgent();
	agent.disableNetConnect();
	closeAfterTest.push(() => agent.close());
	return agent;
}

describe("fetchUrlOrThrow (redirect SSRF)", () => {
	afterEach(async () => {
		await Promise.all(closeAfterTest.splice(0).map((close) => close()));
		vi.restoreAllMocks();
	});

	it("follows a public redirect through the real undici dispatcher", async () => {
		const agent = createMockAgent();
		const pool = agent.get("https://example.com");
		pool.intercept({ path: "/start" }).reply(302, "", { headers: { location: "https://example.com/final" } });
		pool.intercept({ path: "/final" }).reply(200, "ok", { headers: { "content-type": "text/plain" } });

		const res = await fetchUrlOrThrow("https://example.com/start", undefined, resolvePublic, agent);
		expect(await res.text()).toBe("ok");
		expect(agent.pendingInterceptors()).toHaveLength(0);
	});

	it("rejects redirect into a private host", async () => {
		const agent = createMockAgent();
		agent.get("https://evil.example").intercept({ path: "/open" }).reply(302, "", {
			headers: { location: "http://169.254.169.254/latest/meta-data" },
		});

		await expect(fetchUrlOrThrow("https://evil.example/open", undefined, resolvePublic, agent)).rejects.toThrow(/private\/loopback/);
	});

	it("rejects relative redirect that resolves to loopback", async () => {
		const agent = createMockAgent();
		agent.get("https://public.example").intercept({ path: "/x" }).reply(302, "", {
			headers: { location: "http://127.0.0.1/secret" },
		});

		await expect(fetchUrlOrThrow("https://public.example/x", undefined, resolvePublic, agent)).rejects.toThrow(/private\/loopback/);
	});

	it("rejects a public hostname that resolves to a private address before fetch", async () => {
		const agent = createMockAgent();
		agent.get("https://internal.example").intercept({ path: "/" }).reply(200, "should not fetch");
		const resolvePrivate = async () => [{ address: "127.0.0.1", family: 4 as const }];

		await expect(fetchUrlOrThrow("https://internal.example/", undefined, resolvePrivate, agent)).rejects.toThrow(/resolved to private\/loopback/);
		expect(agent.pendingInterceptors()).toHaveLength(1);
	});

	it("rejects mixed public/private and mapped-private DNS answers", async () => {
		const agent = createMockAgent();
		agent.get("https://mixed.example").intercept({ path: "/" }).reply(200, "should not fetch");
		const resolveMixed = async () => [
			{ address: "93.184.216.34", family: 4 },
			{ address: "::ffff:10.0.0.1", family: 6 },
		];

		await expect(fetchUrlOrThrow("https://mixed.example/", undefined, resolveMixed, agent)).rejects.toThrow(/resolved to private\/loopback/);
		expect(agent.pendingInterceptors()).toHaveLength(1);
	});

	it("rechecks DNS after every redirect", async () => {
		const agent = createMockAgent();
		agent.get("https://public.example").intercept({ path: "/start" }).reply(302, "", {
			headers: { location: "https://internal.example/secret" },
		});
		const resolveHost = async (hostname: string) => [
			{ address: hostname === "internal.example" ? "10.0.0.1" : "93.184.216.34", family: 4 as const },
		];

		await expect(fetchUrlOrThrow("https://public.example/start", undefined, resolveHost, agent)).rejects.toThrow(/resolved to private\/loopback/);
		expect(agent.pendingInterceptors()).toHaveLength(0);
	});

	it("cancels a redirect body before a validation error", async () => {
		const cancel = vi.spyOn(ReadableStream.prototype, "cancel");
		const agent = createMockAgent();
		agent.get("https://public.example").intercept({ path: "/missing-location" }).reply(302, "streamed body");

		await expect(fetchUrlOrThrow("https://public.example/missing-location", undefined, resolvePublic, agent)).rejects.toThrow(/without Location/);
		expect(cancel).toHaveBeenCalled();
	});

	it("rejects DNS rebinding at connect time", async () => {
		const rebindAgent = createSsrfSafeDirectAgent(async () => [{ address: "127.0.0.1", family: 4 }]);
		closeAfterTest.push(() => rebindAgent.close());

		try {
			await fetchUrlOrThrow("https://public.example/", undefined, resolvePublic, rebindAgent);
			expect.fail("expected connect-time DNS validation to reject");
		} catch (error) {
			expect((error as { cause?: Error }).cause?.message).toMatch(/resolved to private\/loopback/);
		}
	});
});

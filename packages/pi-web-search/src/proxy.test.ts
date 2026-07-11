import { createServer } from "node:http";
import { getGlobalDispatcher } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUrlOrThrow, fetchViaGenericHtml } from "./html.js";
import { fetchWithProxy, getInstalledProxyUrl, installProxyDispatcher } from "./proxy.js";

const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("installProxyDispatcher", () => {
	it("is a no-op (returns undefined) when no proxy env var is set", async () => {
		for (const v of PROXY_VARS) vi.stubEnv(v, "");
		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "");
		// idempotency guard means we can only assert the no-proxy branch reliably
		// in a fresh module; here we at least confirm it doesn't throw.
		await expect(installProxyDispatcher()).resolves.toBeTypeOf("undefined");
	});

	it("opts out when BYTE_PI_WEB_NO_PROXY is set even with a proxy present", async () => {
		vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:7890");
		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "1");
		await expect(installProxyDispatcher()).resolves.toBeUndefined();
	});

	it("never changes the process global dispatcher", async () => {
		const globalDispatcher = getGlobalDispatcher();
		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "");

		await installProxyDispatcher("http://127.0.0.1:7890");
		expect(getGlobalDispatcher()).toBe(globalDispatcher);
		await installProxyDispatcher("http://127.0.0.1:7891");
		expect(getGlobalDispatcher()).toBe(globalDispatcher);

		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "1");
		await installProxyDispatcher();
		expect(getGlobalDispatcher()).toBe(globalDispatcher);
	});

	it("tracks HTTP and HTTPS proxy routes separately", async () => {
		for (const v of PROXY_VARS) vi.stubEnv(v, "");
		vi.stubEnv("http_proxy", "http://127.0.0.1:7001");
		vi.stubEnv("https_proxy", "http://127.0.0.1:7002");
		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "");

		await expect(installProxyDispatcher()).resolves.toBe("http://127.0.0.1:7002");
		expect(getInstalledProxyUrl("http:")).toBe("http://127.0.0.1:7001");
		expect(getInstalledProxyUrl("https:")).toBe("http://127.0.0.1:7002");

		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "1");
		await installProxyDispatcher();
	});

	it("uses a dedicated ProxyAgent despite NO_PROXY, then clears state on opt-out", async () => {
		const proxy = "http://user:pass@127.0.0.1:7890";
		vi.stubEnv("NO_PROXY", "example.com");
		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "");

		await expect(installProxyDispatcher(proxy)).resolves.toBe(proxy);
		expect(getInstalledProxyUrl()).toBe(proxy);

		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "1");
		await expect(installProxyDispatcher(proxy)).resolves.toBeUndefined();
		expect(getInstalledProxyUrl()).toBeUndefined();
	});

	it("delegates package fetches to global fetch when no package proxy is active", async () => {
		for (const v of PROXY_VARS) vi.stubEnv(v, "");
		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "1");
		await installProxyDispatcher();
		const fetchMock = vi.fn(async () => new Response("direct"));
		vi.stubGlobal("fetch", fetchMock);

		const response = await fetchWithProxy("https://example.com");
		expect(await response.text()).toBe("direct");
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("routes generic fetch through the authenticated proxy even when NO_PROXY matches", async () => {
		const connectTargets: string[] = [];
		const proxyAuthorizations: Array<string | undefined> = [];
		const proxyServer = createServer();
		proxyServer.on("connect", (request, socket) => {
			connectTargets.push(request.url ?? "");
			proxyAuthorizations.push(request.headers["proxy-authorization"]);
			socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			socket.once("data", (requestBytes) => {
				const binary = requestBytes.toString().includes("/binary");
				const type = binary ? "image/png" : "text/plain";
				socket.end(`HTTP/1.1 200 OK\r\nContent-Type: ${type}\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok`);
			});
		});
		await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
		const address = proxyServer.address();
		if (!address || typeof address === "string") throw new Error("proxy test server did not bind a TCP port");

		try {
			vi.stubEnv("NO_PROXY", "public.example");
			vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "");
			const proxy = `http://user:pass@127.0.0.1:${address.port}`;
			await installProxyDispatcher(proxy);

			const providerResponse = await fetchWithProxy("http://provider.example/probe");
			expect(await providerResponse.text()).toBe("ok");

			const response = await fetchUrlOrThrow("http://public.example/probe", AbortSignal.timeout(5_000));
			expect(await response.text()).toBe("ok");
			expect(connectTargets).toEqual(["provider.example:80", "public.example:80"]);
			expect(proxyAuthorizations).toEqual([
				`Basic ${Buffer.from("user:pass").toString("base64")}`,
				`Basic ${Buffer.from("user:pass").toString("base64")}`,
			]);

			const cancel = vi.spyOn(ReadableStream.prototype, "cancel");
			await expect(fetchViaGenericHtml("http://public.example/binary", false, AbortSignal.timeout(5_000))).rejects.toThrow(/Unsupported content type/);
			expect(cancel).toHaveBeenCalled();
		} finally {
			vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "1");
			await installProxyDispatcher();
			proxyServer.closeAllConnections();
			await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
		}
	});

	it("keeps and reports the previous route when a replacement proxy is invalid", async () => {
		const previous = "http://127.0.0.1:7890";
		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "");
		await installProxyDispatcher(previous);

		await expect(installProxyDispatcher("://invalid")).resolves.toBe(previous);
		expect(getInstalledProxyUrl("http:")).toBe(previous);
		expect(getInstalledProxyUrl("https:")).toBe(previous);

		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "1");
		await installProxyDispatcher();
	});
});

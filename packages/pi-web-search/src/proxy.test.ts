import { afterEach, describe, expect, it, vi } from "vitest";
import { installProxyDispatcher } from "./proxy.js";

const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

afterEach(() => vi.unstubAllEnvs());

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
});

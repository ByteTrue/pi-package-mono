import { afterEach, describe, expect, it, vi } from "vitest";
import { installProxyDispatcher } from "./proxy.js";

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await installProxyDispatcher();
	vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "1");
	await installProxyDispatcher();
});

describe("proxy validation (BYTE-6 #13)", () => {
	it("refuses to save a socks proxy in /web and keeps the config unchanged", async () => {
		const { registerWebCommand } = await import("./tools.js");
		const { writeConfig } = await import("./config.js");
		const saved = vi.spyOn({ writeConfig }, "writeConfig");
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		registerWebCommand({
			registerCommand: (_name: string, definition: typeof command) => { command = definition; },
		} as never);
		const notify = vi.fn();
		const select = vi.fn(async (_title: string, options: string[]) => options.find((option) => option.startsWith("⚙")));
		const input = vi.fn(async () => "socks5://proxy.example:1080");
		await command!.handler("", { hasUI: true, ui: { select, input, notify } });

		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Only http:// or https://"), "error");
	});

	it("warns once when an environment proxy is not http(s)", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubEnv("HTTPS_PROXY", "socks5://proxy.example:1080");
		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "");
		await installProxyDispatcher();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain("socks5://proxy.example:1080");

		// second install with the same value stays silent (warn once)
		await installProxyDispatcher();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("keeps accepting http(s) proxies without warnings", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:7890");
		vi.stubEnv("BYTE_PI_WEB_NO_PROXY", "");
		await expect(installProxyDispatcher()).resolves.toBe("http://127.0.0.1:7890");
		expect(warn).not.toHaveBeenCalled();
	});
});

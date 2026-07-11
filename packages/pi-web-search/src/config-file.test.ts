import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;

function configPath(): string {
	return join(root, "byte-pi-web", "config.json");
}

function writeRawConfig(raw: string): void {
	mkdirSync(join(root, "byte-pi-web"), { recursive: true });
	writeFileSync(configPath(), raw, "utf8");
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-web-config-"));
	vi.stubEnv("PI_CONFIG_DIR", root);
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("readConfigResult", () => {
	it("distinguishes a missing config from a valid config", async () => {
		const { readConfigResult } = await import("./config.js");
		expect(readConfigResult()).toEqual({ status: "missing", config: {} });

		writeRawConfig('{"provider":"bing"}');
		expect(readConfigResult()).toEqual({ status: "valid", config: { provider: "bing" } });
	});

	it("reports malformed JSON while readConfig remains fail-soft", async () => {
		writeRawConfig('{"provider":"exa-free"');
		const { readConfig, readConfigResult } = await import("./config.js");

		expect(readConfigResult()).toMatchObject({ status: "invalid" });
		expect(readConfig()).toEqual({});
	});

	it("reports schema-invalid JSON", async () => {
		writeRawConfig('{"provider":42}');
		const { readConfigResult } = await import("./config.js");

		expect(readConfigResult()).toMatchObject({ status: "invalid" });
	});
});

describe("/web invalid-config guard", () => {
	it("notifies and leaves malformed config byte-for-byte unchanged", async () => {
		const token = "LEAKME";
		const original = `{"provider":"exa-free","apiKeys":{"exa":${token}}}`;
		let rawParserMessage = "";
		try {
			JSON.parse(original);
		} catch (error) {
			rawParserMessage = (error as Error).message;
		}
		expect(rawParserMessage).toContain(token);
		writeRawConfig(original);
		const { registerWebCommand } = await import("./tools.js");
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const notify = vi.fn();
		registerWebCommand({
			registerCommand: (_name: string, definition: typeof command) => { command = definition; },
		} as never);

		await command!.handler("", { hasUI: true, ui: { notify } });

		expect(readFileSync(configPath(), "utf8")).toBe(original);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining(configPath()), "error");
		expect(notify.mock.calls.flat().join(" ")).not.toContain(token);
	});
});

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

		writeRawConfig('{"providers":["bing"]}');
		expect(readConfigResult()).toEqual({ status: "valid", config: { providers: ["bing"] } });
	});

	it("reports malformed JSON while readConfig remains fail-soft", async () => {
		writeRawConfig('{"providers":["exa-free"');
		const { readConfig, readConfigResult } = await import("./config.js");

		expect(readConfigResult()).toMatchObject({ status: "invalid" });
		expect(readConfig()).toEqual({});
	});

	it("reports schema-invalid JSON", async () => {
		writeRawConfig('{"providers":42}');
		const { readConfigResult } = await import("./config.js");

		expect(readConfigResult()).toMatchObject({ status: "invalid" });
	});
});

describe("/web provider selection", () => {
	it("switches from paid Exa to Exa free without a label-prefix collision", async () => {
		writeRawConfig(JSON.stringify({ providers: ["exa"], apiKeys: { exa: "secret" }, futureField: true }));
		const { registerWebCommand } = await import("./tools.js");
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		registerWebCommand({
			registerCommand: (_name: string, definition: typeof command) => { command = definition; },
		} as never);
		const select = vi.fn(async (_title: string, options: string[]) =>
			options.find((option) => option.startsWith("Exa (free,")),
		);
		const notify = vi.fn();
		await command!.handler("", { hasUI: true, ui: { select, notify, input: vi.fn() } });
		const saved = JSON.parse(readFileSync(configPath(), "utf8"));
		expect(saved).toEqual({ providers: ["exa-free", "exa"], apiKeys: { exa: "secret" }, futureField: true });
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Exa (free"), "info");
	});
	it("configures a provider fallback chain in menu order", async () => {
		writeRawConfig(JSON.stringify({ providers: ["exa-free"], apiKeys: { tavily: "secret" } }));
		const { registerWebCommand } = await import("./tools.js");
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		registerWebCommand({
			registerCommand: (_name: string, definition: typeof command) => { command = definition; },
		} as never);
		const chainOptions: string[][] = [];
		const select = vi.fn(async (title: string, options: string[]) => {
			if (title.startsWith("Web provider chain")) chainOptions.push(options);
			if (title === "Web search provider") return options.find((option) => option.startsWith("Configure provider fallback chain"));
			if (options.some((option) => option.startsWith("Exa (free,"))) return options.find((option) => option.startsWith("Exa (free,"));
			if (options.some((option) => option.startsWith("Tavily"))) return options.find((option) => option.startsWith("Tavily"));
			return "✓ Done";
		});
		const notify = vi.fn();
		await command!.handler("", { hasUI: true, ui: { select, notify, input: vi.fn() } });
		expect(chainOptions.flat().some((option) => option.startsWith("SearXNG"))).toBe(false);
		expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({ providers: ["exa-free", "tavily"], apiKeys: { tavily: "secret" } });
		expect(notify).toHaveBeenCalledWith("Provider chain saved: exa-free -> tavily", "info");
	});

	it("masks proxy credentials in /web --show", async () => {
		writeRawConfig(JSON.stringify({ proxy: "http://proxy-user:proxy-secret@proxy.example:8080" }));
		const { registerWebCommand } = await import("./tools.js");
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		registerWebCommand({
			registerCommand: (_name: string, definition: typeof command) => { command = definition; },
		} as never);
		const notify = vi.fn();
		await command!.handler("--show", { hasUI: true, ui: { notify } });
		const visible = notify.mock.calls.flat().join(" ");
		expect(visible).toContain("http://****:****@proxy.example:8080");
		expect(visible).not.toMatch(/proxy-user|proxy-secret/);
	});

	it("masks proxy credentials in menu, placeholder, and save notification", async () => {
		writeRawConfig(JSON.stringify({ proxy: "http://old-user:old-secret@proxy.example:8080" }));
		const { registerWebCommand } = await import("./tools.js");
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		registerWebCommand({
			registerCommand: (_name: string, definition: typeof command) => { command = definition; },
		} as never);
		const visible: string[] = [];
		const select = vi.fn(async (_title: string, options: string[]) => {
			visible.push(...options);
			return options.find((option) => option.startsWith("⚙"));
		});
		const input = vi.fn(async (_title: string, placeholder?: string) => {
			if (placeholder) visible.push(placeholder);
			return "http://new-user:new-secret@new-proxy.example:8081";
		});
		const notify = vi.fn((message: string) => visible.push(message));
		await command!.handler("", { hasUI: true, ui: { select, input, notify } });
		expect(visible.join(" ")).not.toMatch(/old-user|old-secret|new-user|new-secret/);
		expect(visible.join(" ")).toContain("****:****@");
		expect(JSON.parse(readFileSync(configPath(), "utf8")).proxy).toBe(
			"http://new-user:new-secret@new-proxy.example:8081",
		);
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

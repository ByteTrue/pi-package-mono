import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;

function configPath(): string {
	return join(root, "pi-pkg-cfg", "pi-web-search", "config.json");
}

function legacyPath(): string {
	return join(root, "byte-pi-web", "config.json");
}

function writeAt(path: string, raw: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, raw, "utf8");
}

function writeRawConfig(raw: string): void {
	writeAt(configPath(), raw);
}

function writeLegacyConfig(raw: string): void {
	writeAt(legacyPath(), raw);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-web-config-"));
	vi.stubEnv("PI_PKG_CFG_DIR", join(root, "pi-pkg-cfg"));
	vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
	vi.stubEnv("PI_CONFIG_DIR", root);
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("config location", () => {
	it("reads and writes the pkg-config root, not the older path", async () => {
		const { getConfigPath, getWritableConfigPath, writeConfig } = await import("./config.js");

		expect(getConfigPath()).toBe(configPath());
		expect(getWritableConfigPath()).toBe(configPath());
		expect(writeConfig({ providers: ["bing"] })).toBe(true);
		expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({ providers: ["bing"] });
		expect(existsSync(legacyPath())).toBe(false);
	});

	it("falls back to the agent dir when PI_PKG_CFG_DIR is unset", async () => {
		vi.stubEnv("PI_PKG_CFG_DIR", "");
		vi.resetModules();
		const { getConfigPath } = await import("./config.js");

		expect(getConfigPath()).toBe(join(root, "agent", "pi-pkg-cfg", "pi-web-search", "config.json"));
	});

	it("uses the default agent dir when PI_CODING_AGENT_DIR is unset too", async () => {
		vi.stubEnv("PI_PKG_CFG_DIR", "");
		vi.stubEnv("PI_CODING_AGENT_DIR", "");
		vi.resetModules();
		const { getConfigPath } = await import("./config.js");

		expect(getConfigPath()).toBe(join(homedir(), ".pi", "agent", "pi-pkg-cfg", "pi-web-search", "config.json"));
	});

	it("copies a legacy file over byte-for-byte and leaves the original in place", async () => {
		const original = `${JSON.stringify({ providers: ["tavily"], apiKeys: { tavily: "legacy-key" }, futureField: true }, null, 2)}\n`;
		writeLegacyConfig(original);
		const { getConfigPath, isLegacyConfigPath, readConfigResult } = await import("./config.js");

		expect(readConfigResult()).toEqual({
			status: "valid",
			config: { providers: ["tavily"], apiKeys: { tavily: "legacy-key" }, futureField: true },
		});
		expect(isLegacyConfigPath()).toBe(false);
		expect(getConfigPath()).toBe(configPath());
		expect(readFileSync(configPath(), "utf8")).toBe(original);
		expect(readFileSync(legacyPath(), "utf8")).toBe(original);
	});

	it("ignores the legacy file once the new one exists", async () => {
		writeLegacyConfig(JSON.stringify({ providers: ["tavily"] }));
		writeRawConfig(JSON.stringify({ providers: ["bing"] }));
		const { readConfigResult } = await import("./config.js");

		expect(readConfigResult()).toEqual({ status: "valid", config: { providers: ["bing"] } });
	});

	it("reads a broken legacy file in place instead of copying it forward", async () => {
		writeLegacyConfig('{"providers":["tavily"');
		const { getConfigPath, isLegacyConfigPath, readConfig, readConfigResult } = await import("./config.js");

		expect(readConfigResult()).toMatchObject({ status: "invalid" });
		expect(readConfig()).toEqual({});
		expect(isLegacyConfigPath()).toBe(true);
		expect(getConfigPath()).toBe(legacyPath());
		expect(existsSync(configPath())).toBe(false);
	});
});

describe("writeConfig failure hygiene", () => {
	it("removes the plaintext-key temp file when the rename fails (BYTE-5 A2)", async () => {
		const { getWritableConfigPath, writeConfig } = await import("./config.js");
		const path = getWritableConfigPath();
		mkdirSync(join(path, ".."), { recursive: true });
		// A directory at the target makes renameSync fail on every platform
		// (EISDIR/EPERM), the same window a Windows AV/indexer lock opens.
		mkdirSync(path, { recursive: true });

		expect(writeConfig({ apiKeys: { tavily: "sk-secret-material" } })).toBe(false);
		// The temp file carried the plaintext key; it must not survive the
		// failed write.
		const leftovers = readdirSync(join(path, "..")).filter((f) => f.endsWith(".tmp"));
		expect(leftovers).toEqual([]);
	});

	it("still writes successfully when the rename is not obstructed", async () => {
		const { getWritableConfigPath, writeConfig } = await import("./config.js");
		expect(writeConfig({ providers: ["bing"] })).toBe(true);
		expect(JSON.parse(readFileSync(getWritableConfigPath(), "utf8"))).toEqual({ providers: ["bing"] });
		expect(readdirSync(join(getWritableConfigPath(), "..")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
	});
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

	it("names the legacy path when a copy cannot be written", async () => {
		// A file where the new root should be: mkdir fails, so the older file
		// stays in charge and must be reported as such.
		writeAt(join(root, "pi-pkg-cfg"), "not a directory");
		writeLegacyConfig(JSON.stringify({ providers: ["bing"] }));
		const { registerWebCommand } = await import("./tools.js");
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		registerWebCommand({
			registerCommand: (_name: string, definition: typeof command) => { command = definition; },
		} as never);
		const notify = vi.fn();
		await command!.handler("--show", { hasUI: true, ui: { notify } });
		const visible = notify.mock.calls.flat().join(" ");

		expect(visible).toContain(`${legacyPath()} (legacy (read-only fallback))`);
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

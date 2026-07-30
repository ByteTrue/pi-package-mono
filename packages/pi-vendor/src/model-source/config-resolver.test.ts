import { describe, expect, it, vi } from "vitest";
import {
	allCommandsTrusted,
	collectCommandPaths,
	createProductionCommandRunner,
	encodeConfigLiteral,
	preflightCommandTrust,
	resolveConfigValue,
} from "./config-resolver.js";

describe("encodeConfigLiteral", () => {
	it("round-trips leading exclamation marks and dollar references as literals", async () => {
		const context = {
			path: { kind: "apiKey" as const },
			providerEnv: {},
			processEnv: { HOME: "/expanded" },
			signal: new AbortController().signal,
			runCommand: vi.fn(),
		};
		await expect(resolveConfigValue(encodeConfigLiteral("!literal"), context))
			.resolves.toMatchObject({ kind: "resolved", value: "!literal" });
		await expect(resolveConfigValue(encodeConfigLiteral("prefix$HOME"), context))
			.resolves.toMatchObject({ kind: "resolved", value: "prefix$HOME" });
		expect(context.runCommand).not.toHaveBeenCalled();
	});
});

describe("resolveConfigValue", () => {
	const fakeRunner = vi.fn<(_body: string, _opts: any) => Promise<string>>();
	const defaultCtx = {
		path: { kind: "apiKey" as const },
		providerEnv: {},
		processEnv: {},
		signal: new AbortController().signal,
		runCommand: fakeRunner,
	};

	it("resolves literal values", async () => {
		const result = await resolveConfigValue("sk-literal-key", defaultCtx);
		expect(result).toEqual({ kind: "resolved", value: "sk-literal-key", source: "env" });
	});

	it("resolves empty string as literal", async () => {
		const result = await resolveConfigValue("", defaultCtx);
		expect(result).toEqual({ kind: "resolved", value: "", source: "literal" });
	});

	it("resolves $VAR from process.env", async () => {
		const result = await resolveConfigValue("$MY_KEY", {
			...defaultCtx,
			processEnv: { MY_KEY: "secret" },
		});
		expect(result).toEqual({ kind: "resolved", value: "secret", source: "env" });
	});

	it("resolves ${VAR} from process.env", async () => {
		const result = await resolveConfigValue("prefix-${MY_KEY}-suffix", {
			...defaultCtx,
			processEnv: { MY_KEY: "secret" },
		});
		expect(result).toEqual({ kind: "resolved", value: "prefix-secret-suffix", source: "env" });
	});

	it("prefers providerEnv over process.env", async () => {
		const result = await resolveConfigValue("$MY_KEY", {
			...defaultCtx,
			providerEnv: { MY_KEY: "provider-value" },
			processEnv: { MY_KEY: "process-value" },
		});
		expect(result).toEqual({ kind: "resolved", value: "provider-value", source: "env" });
	});

	it("returns unresolved when env var is not set", async () => {
		const result = await resolveConfigValue("$MISSING_KEY", defaultCtx);
		expect(result).toEqual({ kind: "unresolved", reason: "Environment variable not set" });
	});

	it("handles $$ as literal dollar sign", async () => {
		const result = await resolveConfigValue("cost$$100", defaultCtx);
		expect(result).toEqual({ kind: "resolved", value: "cost$100", source: "env" });
	});

	it("handles $! as a literal exclamation mark", async () => {
		const result = await resolveConfigValue("cmd$!bang", defaultCtx);
		expect(result).toEqual({ kind: "resolved", value: "cmd!bang", source: "env" });
	});

	it("keeps invalid references and dollar punctuation literal", async () => {
		expect(await resolveConfigValue("${BAD-NAME}", defaultCtx))
			.toEqual({ kind: "resolved", value: "${BAD-NAME}", source: "env" });
		expect(await resolveConfigValue("cost$-value", defaultCtx))
			.toEqual({ kind: "resolved", value: "cost$-value", source: "env" });
	});

	it("handles unclosed ${ as literal", async () => {
		const result = await resolveConfigValue("hello ${WORLD", defaultCtx);
		expect(result).toEqual({ kind: "resolved", value: "hello ${WORLD", source: "env" });
	});

	it("preserves literal whitespace", async () => {
		const result = await resolveConfigValue("  hello world  ", defaultCtx);
		expect(result).toEqual({ kind: "resolved", value: "  hello world  ", source: "env" });
	});

	it("resolves mixed template and literal", async () => {
		const result = await resolveConfigValue("Bearer $TOKEN", {
			...defaultCtx,
			processEnv: { TOKEN: "abc123" },
		});
		expect(result).toEqual({ kind: "resolved", value: "Bearer abc123", source: "env" });
	});

	it("runs !command and returns output", async () => {
		fakeRunner.mockResolvedValueOnce("command-output");
		const result = await resolveConfigValue("!echo hello", defaultCtx);
		expect(result).toEqual({ kind: "resolved", value: "command-output", source: "command" });
		expect(fakeRunner).toHaveBeenCalledWith("echo hello", expect.any(Object));
	});

	it("returns unresolved on command failure", async () => {
		fakeRunner.mockRejectedValueOnce(new Error("fail"));
		const result = await resolveConfigValue("!bad-command", defaultCtx);
		expect(result).toEqual({ kind: "unresolved", reason: "Command execution failed" });
	});

	it("returns unresolved on empty command output", async () => {
		fakeRunner.mockResolvedValueOnce("");
		const result = await resolveConfigValue("!empty-command", defaultCtx);
		expect(result).toEqual({ kind: "unresolved", reason: "Command execution failed" });
	});
});

describe("createProductionCommandRunner", () => {
	const nodeCommand = (source: string): string => `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
	const options = (overrides: Partial<{ signal: AbortSignal; timeoutMs: number; maxStdoutBytes: number }> = {}) => ({
		signal: new AbortController().signal,
		timeoutMs: 2_000,
		maxStdoutBytes: 64 * 1024,
		...overrides,
	});

	it("executes shell commands and trims stdout", async () => {
		const run = createProductionCommandRunner();
		await expect(run(nodeCommand("process.stdout.write('  shell-ok\\n')"), options()))
			.resolves.toBe("shell-ok");
	});

	it("rejects nonzero exit and oversized stdout", async () => {
		const run = createProductionCommandRunner();
		await expect(run(nodeCommand("process.exit(2)"), options())).rejects.toThrow("Command execution failed");
		await expect(run(nodeCommand("process.stdout.write('x'.repeat(65537))"), options()))
			.rejects.toThrow("maximum size");
	});

	it("settles on timeout and abort", async () => {
		const run = createProductionCommandRunner();
		const wait = nodeCommand("setTimeout(() => {}, 5000)");
		await expect(run(wait, options({ timeoutMs: 20 }))).rejects.toThrow("timed out");

		const controller = new AbortController();
		const pending = run(wait, options({ signal: controller.signal }));
		controller.abort();
		await expect(pending).rejects.toThrow("aborted");
	});
});

describe("collectCommandPaths", () => {
	it("collects apiKey !command", () => {
		const paths = collectCommandPaths({ apiKey: "!my-cmd" });
		expect(paths).toEqual([{ path: { kind: "apiKey" }, rawValue: "!my-cmd" }]);
	});

	it("collects header !commands", () => {
		const paths = collectCommandPaths({
			headers: { "X-Key": "!cmd1", "X-Other": "literal" },
		});
		expect(paths).toEqual([{ path: { kind: "header", name: "X-Key" }, rawValue: "!cmd1" }]);
	});

	it("returns empty for non-command values", () => {
		expect(collectCommandPaths({ apiKey: "literal" })).toEqual([]);
		expect(collectCommandPaths({ apiKey: "" })).toEqual([]);
		expect(collectCommandPaths({})).toEqual([]);
	});
});

describe("preflightCommandTrust", () => {
	it("trusts unchanged apiKey command", () => {
		const trusted = preflightCommandTrust(
			{ apiKey: "!cmd" },
			{ apiKey: "!cmd" },
		);
		expect(trusted).toHaveLength(1);
	});

	it("rejects changed apiKey command", () => {
		const trusted = preflightCommandTrust(
			{ apiKey: "!new-cmd" },
			{ apiKey: "!old-cmd" },
		);
		expect(trusted).toHaveLength(0);
	});

	it("rejects newly added command", () => {
		const trusted = preflightCommandTrust(
			{ apiKey: "!cmd" },
			{ apiKey: "literal" },
		);
		expect(trusted).toHaveLength(0);
	});

	it("trusts unchanged header commands", () => {
		const trusted = preflightCommandTrust(
			{ headers: { "X-Key": "!cmd" } },
			{ headers: { "X-Key": "!cmd" } },
		);
		expect(trusted).toHaveLength(1);
	});

	it("rejects changed header command", () => {
		const trusted = preflightCommandTrust(
			{ headers: { "X-Key": "!new-cmd" } },
			{ headers: { "X-Key": "!old-cmd" } },
		);
		expect(trusted).toHaveLength(0);
	});

	it("rejects deleted header command", () => {
		const trusted = preflightCommandTrust(
			{ headers: { "X-Key": "!cmd" } },
			{},
		);
		expect(trusted).toHaveLength(0);
	});
});

describe("allCommandsTrusted", () => {
	it("returns true when no commands exist", () => {
		expect(allCommandsTrusted({ apiKey: "literal" }, { apiKey: "literal" })).toBe(true);
	});

	it("returns true when all commands are trusted", () => {
		expect(allCommandsTrusted(
			{ apiKey: "!cmd1", headers: { "X-Key": "!cmd2" } },
			{ apiKey: "!cmd1", headers: { "X-Key": "!cmd2" } },
		)).toBe(true);
	});

	it("returns false when any command is untrusted (fail-closed)", () => {
		expect(allCommandsTrusted(
			{ apiKey: "!cmd1", headers: { "X-Key": "!changed" } },
			{ apiKey: "!cmd1", headers: { "X-Key": "!cmd2" } },
		)).toBe(false);
	});
});

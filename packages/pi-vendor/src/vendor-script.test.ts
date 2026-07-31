import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "../skills/pi-vendor/scripts/vendor.mjs");
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-vendor-script-"));
	writeFileSync(join(dir, "models.json"), `${JSON.stringify({ providers: { relay: { apiKey: "old", models: [] } } }, null, 2)}\n`);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], options: { env?: NodeJS.ProcessEnv; input?: string } = {}) {
	return execFileSync(process.execPath, [script, ...args], {
		env: { ...process.env, PI_CODING_AGENT_DIR: dir, ...options.env },
		input: options.input,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
}

function runAsync(args: string[], env: NodeJS.ProcessEnv = {}) {
	return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
		const child = spawn(process.execPath, [script, ...args], {
			env: { ...process.env, PI_CODING_AGENT_DIR: dir, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => stdout += chunk);
		child.stderr.on("data", (chunk) => stderr += chunk);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

describe("vendor skill script", () => {
	it("lints the local models.json without starting Pi", () => {
		expect(JSON.parse(run(["lint"]))).toMatchObject({ valid: true, errors: [] });
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: { models: [{ id: "x" }, { id: "x" }] } } }));
		expect(() => run(["lint"])).toThrow();
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: { apiKey: "sk-review-secret", models: [{ id: "sk-review-secret" }, { id: "sk-review-secret" }] } } }));
		try {
			run(["lint"]);
			throw new Error("lint unexpectedly passed");
		} catch (error) {
			const captured = error as { stdout?: Buffer | string; stderr?: Buffer | string };
			expect(`${String(captured.stdout ?? "")}${String(captured.stderr ?? "")}${String(error)}`).not.toContain("sk-review-secret");
		}
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: { models: { x: { id: "x" } } } } }));
		expect(() => run(["lint"])).toThrow();
	});

	it("searches the active Pi catalog and strips routing fields", () => {
		const catalogDir = join(dir, "node_modules/@earendil-works/pi-ai/dist");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		writeFileSync(join(dir, "node_modules/@earendil-works/pi-ai/package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(catalogDir, "models.generated.js"), `export const MODELS = { anthropic: { opus: { id: "claude-opus", name: "Claude Opus", api: "anthropic-messages", baseUrl: "https://secret.invalid", apiKey: "secret", contextWindow: 200000 } } };`);

		const result = JSON.parse(run(["catalog", "opus"], { env: { PI_VENDOR_PI_ROOT: dir, PATH: "" } }));
		expect(result).toEqual({ query: "opus", count: 1, total: 1, results: [{ provider: "anthropic", model: { id: "claude-opus", name: "Claude Opus", api: "anthropic-messages", contextWindow: 200000 } }] });
	});

	it("finds a catalog beside an npm-style Windows shim", () => {
		const shimDir = join(dir, "npm-bin");
		const catalogDir = join(shimDir, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(shimDir, "pi.cmd"), "@echo off\n");
		writeFileSync(join(shimDir, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(catalogDir, "models.generated.js"), `export const MODELS = { test: { model: { id: "shim-model" } } };`);

		const result = JSON.parse(run(["catalog", "shim"], { env: { PI_VENDOR_PI_ROOT: undefined, PATH: shimDir } }));
		expect(result.results[0]).toEqual({ provider: "test", model: { id: "shim-model" } });
	});

	it("discovers model ids without returning credentials", async () => {
		let authorization = "";
		const server = createServer((request, response) => {
			authorization = String(request.headers.authorization ?? "");
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ data: [{ id: "b" }, { id: "a" }, { id: "a" }] }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test address");
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: { baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "prefix-${PI_VENDOR_TEST_KEY}" } } }));
		try {
			const result = await runAsync(["discover", "relay"], { PI_VENDOR_TEST_KEY: "!literal$HOME" });
			expect(result.code).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual({ providerKey: "relay", count: 2, modelIds: ["a", "b"] });
			expect(result.stdout).not.toContain("literal");
			expect(authorization).toBe("Bearer prefix-!literal$HOME");
		} finally {
			server.close();
		}
	});

	it("fails closed when upstream echoes a credential as a model id", async () => {
		const server = createServer((_request, response) => response.end(JSON.stringify({ data: [{ id: "prefix-sk-secret-suffix" }] })));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test address");
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "sk-secret" } } }));
		try {
			const result = await runAsync(["discover", "relay"]);
			expect(result.code).toBe(1);
			expect(result.stdout).not.toContain("sk-secret");
			expect(result.stderr).not.toContain("sk-secret");
		} finally {
			server.close();
		}
	});

	it("fails closed when an Authorization token is echoed as a model id", async () => {
		const server = createServer((_request, response) => response.end(JSON.stringify({ data: [{ id: "sk-header" }] })));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test address");
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: { baseUrl: `http://127.0.0.1:${address.port}`, headers: { Authorization: "Bearer sk-header" } } } }));
		try {
			const result = await runAsync(["discover", "relay"]);
			expect(result.code).toBe(1);
			expect(`${result.stdout}${result.stderr}`).not.toContain("sk-header");
		} finally {
			server.close();
		}
	});

	it("also redacts an unused configured apiKey when Authorization is explicit", async () => {
		const server = createServer((_request, response) => response.end(JSON.stringify({ data: [{ id: "sk-unused" }] })));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test address");
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "sk-unused", headers: { Authorization: "Bearer sk-header" } } } }));
		try {
			const result = await runAsync(["discover", "relay"]);
			expect(result.code).toBe(1);
			expect(`${result.stdout}${result.stderr}`).not.toContain("sk-unused");
		} finally {
			server.close();
		}
	});

	it("redacts body stream failures behind a local error", async () => {
		const server = createServer((_request, response) => {
			response.writeHead(200, { "content-type": "application/json", "content-length": "100" });
			response.write("{");
			response.socket?.destroy();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test address");
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: { baseUrl: `http://127.0.0.1:${address.port}` } } }));
		try {
			const result = await runAsync(["discover", "relay"]);
			expect(result.code).toBe(1);
			expect(["Upstream model discovery failed", "Upstream returned invalid model data"]).toContain(result.stderr.trim());
			expect(result.stderr).not.toContain("127.0.0.1");
		} finally {
			server.close();
		}
	});

	it("sets a key from stdin and never writes it to output", () => {
		const output = run(["set-key", "relay"], { input: "sk-new-secret\n" });
		const saved = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
		expect(saved).toEqual({ providers: { relay: { apiKey: "sk-new-secret", models: [] } } });
		expect(output).not.toContain("sk-new-secret");
	});

	it("escapes Pi config metacharacters in literal keys", () => {
		run(["set-key", "relay"], { input: "!literal$HOME\n" });
		expect(JSON.parse(readFileSync(join(dir, "models.json"), "utf8")).providers.relay.apiKey).toBe("$!literal$$HOME");
	});

	it("does not change the file when the provider is missing", () => {
		const before = readFileSync(join(dir, "models.json"), "utf8");
		expect(() => run(["set-key", "missing"], { input: "sk-new-secret\n" })).toThrow();
		expect(readFileSync(join(dir, "models.json"), "utf8")).toBe(before);
	});

	it("aborts instead of overwriting a concurrent edit", async () => {
		const path = join(dir, "models.json");
		const child = spawn(process.execPath, [script, "set-key", "relay"], {
			env: { ...process.env, PI_CODING_AGENT_DIR: dir },
			stdio: ["pipe", "pipe", "pipe"],
		});
		await new Promise<void>((resolve) => child.stderr.once("data", () => resolve()));
		writeFileSync(path, `${JSON.stringify({ providers: { relay: { apiKey: "old", models: [] }, concurrent: { apiKey: "other", models: [] } } }, null, 2)}\n`);
		child.stdin.end("sk-new-secret\n");
		const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
		expect(code).toBe(1);
		expect(JSON.parse(readFileSync(path, "utf8"))).toHaveProperty("providers.concurrent.apiKey", "other");
	});
});

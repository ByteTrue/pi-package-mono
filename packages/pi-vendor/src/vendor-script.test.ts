import { execFileSync, spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders } from "node:http";
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
	it("rejects the removed compare and lint commands", () => {
		expect(() => run(["compare", "relay"])).toThrow();
		expect(() => run(["lint"])).toThrow();
	});

	it("searches the active Pi catalog and strips routing fields", () => {
		const catalogDir = join(dir, "node_modules/@earendil-works/pi-ai/dist");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		writeFileSync(join(dir, "node_modules/@earendil-works/pi-ai/package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(catalogDir, "models.generated.js"), `export const MODELS = { alibaba: { qwen: { id: "qwen3.7", name: "Qwen 3.7", api: "openai-completions", baseUrl: "https://secret.invalid", apiKey: "secret", contextWindow: 200000 } } };`);

		const result = JSON.parse(run(["catalog", "qwen 3.7"], { env: { PI_VENDOR_PI_ROOT: dir, PATH: "" } }));
		expect(result).toEqual({ source: "official-catalog", query: "qwen 3.7", count: 1, total: 1, results: [{ officialProvider: "alibaba", model: { id: "qwen3.7", name: "Qwen 3.7", api: "openai-completions", contextWindow: 200000 } }] });
	});

	it("finds a catalog beside an npm-style Windows shim", () => {
		const shimDir = join(dir, "npm-bin");
		const catalogDir = join(shimDir, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(shimDir, "pi.cmd"), "@echo off\n");
		writeFileSync(join(shimDir, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(catalogDir, "models.generated.js"), `export const MODELS = { test: { model: { id: "shim-model" } } };`);

		const result = JSON.parse(run(["catalog", "shim"], { env: { PI_VENDOR_PI_ROOT: undefined, PATH: shimDir } }));
		expect(result.results[0]).toEqual({ officialProvider: "test", model: { id: "shim-model" } });
	});

	it("finds a catalog through a mise/aube bin shim that points at a relocated package", () => {
		const prefix = join(dir, "node_modules");
		const packageDir = join(prefix, ".mise", "@earendil-works+pi-coding-agent@0.85.1", "node_modules", "@earendil-works", "pi-coding-agent");
		const catalogDir = join(prefix, ".mise", "@earendil-works+pi-coding-agent@0.85.1", "node_modules", "@earendil-works", "pi-ai", "dist");
		mkdirSync(join(prefix, ".bin"), { recursive: true });
		mkdirSync(packageDir, { recursive: true });
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		writeFileSync(join(catalogDir, "package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(catalogDir, "models.generated.js"), `export const MODELS = { official: { m: { id: "relocated-model" } } };`);
		writeFileSync(join(prefix, ".bin", "pi"), "#!/bin/sh\n# aube-bin-shim v2 target=../.mise/@earendil-works+pi-coding-agent@0.85.1/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js\nexec node \"$basedir/../.mise/@earendil-works+pi-coding-agent@0.85.1/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js\" \"$@\"\n");

		const result = JSON.parse(run(["catalog", "relocated"], { env: { PI_VENDOR_PI_ROOT: undefined, PATH: join(prefix, ".bin") } }));
		expect(result.results[0]).toEqual({ officialProvider: "official", model: { id: "relocated-model" } });
	});

	it("finds a catalog beside a mise .bin entry even without shim text", () => {
		const prefix = join(dir, "node_modules");
		const packageDir = join(prefix, ".mise", "@earendil-works+pi-coding-agent@0.9.0", "node_modules", "@earendil-works", "pi-coding-agent");
		const catalogDir = join(prefix, ".mise", "@earendil-works+pi-coding-agent@0.9.0", "node_modules", "@earendil-works", "pi-ai", "dist");
		mkdirSync(join(prefix, ".bin"), { recursive: true });
		mkdirSync(packageDir, { recursive: true });
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(prefix, ".bin", "pi"), "#!/bin/sh\nexec something-else\"$@\"\n");
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		writeFileSync(join(catalogDir, "package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(catalogDir, "models.generated.js"), `export const MODELS = { official: { m: { id: "sibling-model" } } };`);

		const result = JSON.parse(run(["catalog", "sibling"], { env: { PI_VENDOR_PI_ROOT: undefined, PATH: join(prefix, ".bin") } }));
		expect(result.results[0]).toEqual({ officialProvider: "official", model: { id: "sibling-model" } });
	});

	it("reports the recovery hint when no catalog can be located", () => {
		let message = "";
		try { run(["catalog", "anything"], { env: { PI_VENDOR_PI_ROOT: undefined, PATH: "" } }); } catch (error) {
			message = String((error as { stderr?: string }).stderr ?? "");
		}
		expect(message).toContain("PI_VENDOR_PI_ROOT");
	});

	it("reports official template drift as machine output without mutating anything", () => {
		const catalogDir = join(dir, "node_modules/@earendil-works/pi-ai/dist");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		writeFileSync(join(catalogDir, "package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(catalogDir, "models.generated.js"), `export const MODELS = { vendor: { demo: { id: "demo-model", name: "Demo Model Official", api: "openai-completions", reasoning: true, cost: { input: 1.5, output: 2 }, contextWindow: 100000 }, fresh: { id: "fresh-model", name: "Fresh", api: "openai-completions", reasoning: true, cost: { input: 3, output: 4 }, contextWindow: 200000 } } };`);
		writeFileSync(join(dir, "models.json"), `${JSON.stringify({ providers: { relay: { apiKey: "secret", models: [
			{ id: "demo-model", api: "openai-completions", name: "Demo Model", cost: { input: 1, output: 2 }, contextWindow: 100000, reasoning: true },
			{ id: "fresh-model", api: "openai-completions", name: "Fresh", cost: { input: 3, output: 4 }, contextWindow: 200000, reasoning: true },
		] } } }, null, 2)}\n`);

		const output = run(["drift", "relay"], { env: { PI_VENDOR_PI_ROOT: dir, PATH: "" } });
		const parsed = JSON.parse(output.slice(0, output.indexOf("#### Official template drift")).trim());
		expect(parsed).toMatchObject({ source: "official-catalog-drift", providerKey: "relay", checked: 2, drifted: 1, upToDate: 1, noOfficialMatch: [] });
		expect(parsed.models[0]).toMatchObject({ id: "demo-model" });
		expect(parsed.models[0].matches[0].differences).toEqual([
			{ field: "cost.input", configured: 1, official: 1.5 },
			{ field: "name", configured: "Demo Model", official: "Demo Model Official" },
		]);
		expect(output).toContain("| model id | official source | field | configured | official |");
		expect(output).toContain("| demo-model | vendor (demo-model) | cost.input | 1 | 1.5 |");
		expect(output).toContain("Up to date against at least one matched official source: 1 model(s).");
		expect(JSON.parse(readFileSync(join(dir, "models.json"), "utf8")).providers.relay.models[0]).toEqual({ id: "demo-model", api: "openai-completions", name: "Demo Model", cost: { input: 1, output: 2 }, contextWindow: 100000, reasoning: true });
	});

	it("treats routing overrides as non-drift and null as absent", () => {
		const catalogDir = join(dir, "node_modules/@earendil-works/pi-ai/dist");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		writeFileSync(join(catalogDir, "package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(catalogDir, "models.generated.js"), `export const MODELS = { vendor: { m: { id: "routed-model", name: "Routed", api: "anthropic-messages", baseUrl: "https://official.invalid", thinkingLevelMap: { off: null, low: "low" }, contextWindow: 1000 } } };`);
		writeFileSync(join(dir, "models.json"), `${JSON.stringify({ providers: { relay: { baseUrl: "http://gateway.invalid/v1", models: [
			{ id: "routed-model", api: "openai-completions", baseUrl: "http://gateway.invalid", name: "Routed", thinkingLevelMap: { low: "low" }, contextWindow: 1000 },
		] } } }, null, 2)}\n`);

		const output = run(["drift", "relay"], { env: { PI_VENDOR_PI_ROOT: dir, PATH: "" } });
		const parsed = JSON.parse(output.slice(0, output.indexOf("#### Official template drift")).trim());
		expect(parsed.drifted).toBe(0);
		expect(parsed.upToDate).toBe(1);
		expect(output).toContain("Every configured model still matches at least one current official template exactly.");
	});

	it("matches vendor-prefixed ids and honors the provider restrict argument", () => {
		const catalogDir = join(dir, "node_modules/@earendil-works/pi-ai/dist");
		mkdirSync(catalogDir, { recursive: true });
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		writeFileSync(join(catalogDir, "package.json"), JSON.stringify({ type: "module" }));
		writeFileSync(join(catalogDir, "models.generated.js"), `export const MODELS = { vendor: { v: { id: "vision-model", name: "Vision", api: "openai-completions", cost: { input: 1, output: 2 }, contextWindow: 1000 } }, hub: { h: { id: "vendor/vision-model", name: "Vision Hub", api: "openai-completions", cost: { input: 9, output: 9 }, contextWindow: 9000 } } };`);
		writeFileSync(join(dir, "models.json"), `${JSON.stringify({ providers: { relay: { models: [
			{ id: "vendor/vision-model", api: "openai-completions", name: "Vision", cost: { input: 1, output: 2 }, contextWindow: 1000 },
			{ id: "custom-only", api: "openai-completions", name: "Custom" },
		] } } }, null, 2)}\n`);

		const unrestricted = run(["drift", "relay"], { env: { PI_VENDOR_PI_ROOT: dir, PATH: "" } });
		const parsed = JSON.parse(unrestricted.slice(0, unrestricted.indexOf("#### Official template drift")).trim());
		expect(parsed.checked).toBe(2);
		expect(parsed.upToDate).toBe(1);
		expect(parsed.noOfficialMatch).toEqual(["custom-only"]);
		expect(unrestricted).toContain("No matching official catalog entry found for: custom-only.");

		const restricted = run(["drift", "relay", "hub"], { env: { PI_VENDOR_PI_ROOT: dir, PATH: "" } });
		const restrictedParsed = JSON.parse(restricted.slice(0, restricted.indexOf("#### Official template drift")).trim());
		expect(restrictedParsed.drifted).toBe(1);
		expect(restrictedParsed.models[0].matches).toHaveLength(1);
		expect(restrictedParsed.models[0].matches[0]).toMatchObject({ officialProvider: "hub", matchType: "exact" });
		expect(restricted).toContain("| vendor/vision-model | hub (vendor/vision-model) | cost.input | 1 | 9 |");
	});

	it("discovers model ids without returning credentials", async () => {
		let authorization = "";
		const server = createServer((request, response) => {
			if (request.headers.authorization) authorization = String(request.headers.authorization);
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
			expect(JSON.parse(result.stdout).routes).toEqual([
				{ routeId: 1, api: "openai-completions", status: "ok", count: 2, modelIds: ["a", "b"] },
				{ routeId: 2, api: "openai-responses", status: "ok", count: 2, modelIds: ["a", "b"] },
				{ routeId: 3, api: "anthropic-messages", status: "ok", count: 2, modelIds: ["a", "b"] },
				{ routeId: 4, api: "google-generative-ai", status: "error", errorCode: "discovery_failed" },
			]);
			expect(result.stdout).not.toContain("literal");
			expect(authorization).toBe("Bearer prefix-!literal$HOME");
		} finally {
			server.close();
		}
	});

	it("discovers and deduplicates all four provider API types in one command", async () => {
		const seen: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
		const server = createServer((request, response) => {
			seen.push({ url: request.url ?? "", headers: request.headers });
			if (request.url === "/v1beta/models") {
				response.end(JSON.stringify({ models: [{ name: "models/gemini-x" }] }));
			} else if (request.url === "/v1/models") {
				response.end(JSON.stringify({ data: [{ id: "claude-x" }] }));
			} else {
				response.end(JSON.stringify({ data: [{ id: "openai-x" }] }));
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test address");
		const origin = `http://127.0.0.1:${address.port}`;
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: {
			baseUrl: origin, api: "openai-completions", apiKey: "secret", authHeader: true,
			models: [
				{ id: "claude-route", api: "anthropic-messages" },
				{ id: "claude-route-duplicate", api: "anthropic-messages" },
			],
		} } }));
		try {
			const result = await runAsync(["discover", "relay"]);
			expect(result.code).toBe(0);
			expect(JSON.parse(result.stdout).routes).toEqual([
				{ routeId: 1, api: "openai-completions", status: "ok", count: 1, modelIds: ["openai-x"] },
				{ routeId: 2, api: "openai-responses", status: "ok", count: 1, modelIds: ["openai-x"] },
				{ routeId: 3, api: "anthropic-messages", status: "ok", count: 1, modelIds: ["claude-x"] },
				{ routeId: 4, api: "google-generative-ai", status: "ok", count: 1, modelIds: ["gemini-x"] },
			]);
			expect(seen).toHaveLength(4);
			expect(seen.find((entry) => entry.url === "/v1/models")).toMatchObject({ headers: { "x-api-key": "secret", authorization: "Bearer secret", "anthropic-version": "2023-06-01" } });
			expect(seen.find((entry) => entry.url === "/v1beta/models")).toMatchObject({ headers: { "x-goog-api-key": "secret", authorization: "Bearer secret" } });
		} finally {
			server.close();
		}
	});

	it("adds a distinct model-level override route", async () => {
		const seen: string[] = [];
		const server = createServer((request, response) => {
			seen.push(request.url ?? "");
			if (request.url === "/alternate/models") {
				response.end(JSON.stringify({ data: [{ id: "override-x" }] }));
			} else if (request.url?.endsWith("/v1beta/models")) {
				response.end(JSON.stringify({ models: [{ name: "models/default-x" }] }));
			} else {
				response.end(JSON.stringify({ data: [{ id: "default-x" }] }));
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test address");
		const origin = `http://127.0.0.1:${address.port}`;
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: {
			baseUrl: `${origin}/default`,
			models: [{ id: "override-route", api: "openai-responses", baseUrl: `${origin}/alternate` }],
		} } }));
		try {
			const result = await runAsync(["discover", "relay"]);
			expect(result.code).toBe(0);
			expect(JSON.parse(result.stdout).routes[4]).toEqual({ routeId: 5, api: "openai-responses", status: "ok", count: 1, modelIds: ["override-x"] });
			expect(seen.filter((url) => url === "/alternate/models")).toHaveLength(1);
		} finally {
			server.close();
		}
	});


	it("reports a failed route without hiding successful routes", async () => {
		const server = createServer((request, response) => {
			if (request.url === "/v1beta/models") {
				response.writeHead(503);
				response.end("temporary upstream failure");
				return;
			}
			response.end(JSON.stringify({ data: [{ id: "open-new" }] }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test address");
		const baseUrl = `http://127.0.0.1:${address.port}`;
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { relay: {
			baseUrl, api: "openai-completions", models: [
				{ id: "gemini-configured", api: "google-generative-ai", baseUrl },
			],
		} } }));
		try {
			const result = await runAsync(["discover", "relay"]);
			expect(result.code).toBe(0);
			expect(JSON.parse(result.stdout).routes).toEqual([
				{ routeId: 1, api: "openai-completions", status: "ok", count: 1, modelIds: ["open-new"] },
				{ routeId: 2, api: "openai-responses", status: "ok", count: 1, modelIds: ["open-new"] },
				{ routeId: 3, api: "anthropic-messages", status: "ok", count: 1, modelIds: ["open-new"] },
				{ routeId: 4, api: "google-generative-ai", status: "error", errorCode: "discovery_failed" },
			]);
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
			expect(result.code).toBe(0);
			expect(JSON.parse(result.stdout).routes).toEqual([
				{ routeId: 1, api: "openai-completions", status: "error", errorCode: "discovery_failed" },
				{ routeId: 2, api: "openai-responses", status: "error", errorCode: "discovery_failed" },
				{ routeId: 3, api: "anthropic-messages", status: "error", errorCode: "discovery_failed" },
				{ routeId: 4, api: "google-generative-ai", status: "error", errorCode: "discovery_failed" },
			]);
			expect(`${result.stdout}${result.stderr}`).not.toContain("127.0.0.1");
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

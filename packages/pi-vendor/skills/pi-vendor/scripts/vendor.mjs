#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const [, , command, ...args] = process.argv;
const modelsPath = join(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"), "models.json");
const SUPPORTED_APIS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];

class CliError extends Error {
	constructor(message, code = 1) {
		super(message);
		this.code = code;
	}
}

function fail(message, code = 1) {
	throw new CliError(message, code);
}

function readModels() {
	try {
		return JSON.parse(readFileSync(modelsPath, "utf8"));
	} catch {
		fail(`Unable to read ${modelsPath}`);
	}
}

function output(value) {
	console.log(JSON.stringify(value, null, 2));
}


function packageRoot(entry) {
	if (!entry || !existsSync(entry)) return null;
	let current;
	try {
		current = dirname(realpathSync(entry));
	} catch {
		return null;
	}
	for (;;) {
		try {
			if (JSON.parse(readFileSync(join(current, "package.json"), "utf8")).name === "@earendil-works/pi-coding-agent") return current;
		} catch {}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function catalogPaths() {
	const roots = new Set();
	if (process.env.PI_VENDOR_PI_ROOT) roots.add(process.env.PI_VENDOR_PI_ROOT);
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		for (const name of ["pi", "pi.cmd", "pi.exe"]) {
			const root = packageRoot(join(dir, name));
			if (root) roots.add(root);
		}
		// npm's Windows shim lives beside node_modules rather than inside the package.
		roots.add(join(dir, "node_modules", "@earendil-works", "pi-coding-agent"));
	}
	const paths = [];
	for (const root of roots) {
		paths.push(join(root, "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"));
		paths.push(join(root, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"));
	}
	return paths;
}

function cleanTemplate(model) {
	const copy = structuredClone(model);
	for (const field of ["provider", "baseUrl", "headers", "apiKey", "authHeader"]) delete copy[field];
	return copy;
}

async function catalog(query, limitText) {
	if (!query?.trim()) fail("Usage: vendor.mjs catalog <keyword> [limit]", 2);
	if (Buffer.byteLength(query) > 512) fail("Query exceeds 512 bytes", 2);
	const limit = limitText === undefined ? 50 : Number(limitText);
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("Limit must be an integer from 1 to 100", 2);
	const path = catalogPaths().find(existsSync);
	if (!path) fail("Official catalog is unavailable");
	let models;
	try {
		models = (await import(pathToFileURL(path).href)).MODELS;
	} catch {
		fail("Official catalog is unavailable");
	}
	const needle = query.trim().toLowerCase();
	const normalizedNeedle = needle.replace(/[\s_-]+/g, "");
	const tokens = needle.split(/[^\p{L}\p{N}._-]+/u).filter(Boolean);
	const results = [];
	for (const [provider, entries] of Object.entries(models ?? {})) {
		for (const model of Object.values(entries ?? {})) {
			const id = typeof model?.id === "string" ? model.id : "";
			const name = typeof model?.name === "string" ? model.name : "";
			const haystack = `${id}\n${name}`.toLowerCase();
			const normalizedHaystack = haystack.replace(/[\s_-]+/g, "");
			if (!tokens.every((token) => haystack.includes(token) || normalizedHaystack.includes(token.replace(/[\s_-]+/g, "")))) continue;
			const normalizedId = id.toLowerCase().replace(/[\s_-]+/g, "");
			const score = normalizedId === normalizedNeedle ? 0 : normalizedId.startsWith(normalizedNeedle) ? 1 : normalizedId.includes(normalizedNeedle) ? 2 : 3;
			results.push({ score, officialProvider: provider, model: cleanTemplate(model) });
		}
	}
	results.sort((a, b) => a.score - b.score || a.model.id.localeCompare(b.model.id) || a.officialProvider.localeCompare(b.officialProvider));
	output({ source: "official-catalog", query, count: Math.min(results.length, limit), total: results.length, results: results.slice(0, limit).map(({ officialProvider, model }) => ({ officialProvider, model })) });
}

function resolveTemplate(value) {
	let resolved = "";
	let unresolved = false;
	for (let i = 0; i < value.length;) {
		if (value[i] !== "$" || i + 1 >= value.length) { resolved += value[i++]; continue; }
		const next = value[i + 1];
		if (next === "$" || next === "!") { resolved += next === "$" ? "$" : "!"; i += 2; continue; }
		if (next === "{") {
			const close = value.indexOf("}", i + 2);
			if (close === -1) { resolved += value[i++]; continue; }
			const name = value.slice(i + 2, close);
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { resolved += value.slice(i, close + 1); i = close + 1; continue; }
			const env = process.env[name];
			if (env) resolved += env; else unresolved = true;
			i = close + 1;
			continue;
		}
		if (!/[A-Za-z_]/.test(next)) { resolved += "$"; i++; continue; }
		let end = i + 2;
		while (end < value.length && /[A-Za-z0-9_]/.test(value[end])) end++;
		const env = process.env[value.slice(i + 1, end)];
		if (env) resolved += env; else unresolved = true;
		i = end;
	}
	return unresolved ? undefined : resolved;
}

function resolveValue(value) {
	if (typeof value !== "string" || !value) return undefined;
	if (value.startsWith("!")) {
		try {
			const shell = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
			const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", value.slice(1)] : ["-c", value.slice(1)];
			return execFileSync(shell, shellArgs, { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 }).trim();
		} catch {
			throw new Error("Unable to resolve provider credentials");
		}
	}
	return resolveTemplate(value);
}

function hasHeader(headers, name) {
	return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function discoveryRoute(provider, modelId) {
	const model = modelId ? (provider.models ?? []).find((entry) => entry?.id === modelId) : undefined;
	if (modelId && !model) fail("Configured model was not found");
	return {
		api: model?.api ?? provider.api ?? "openai-completions",
		baseUrl: model?.baseUrl ?? provider.baseUrl,
		headers: { ...(provider.headers ?? {}), ...(model?.headers ?? {}) },
		authHeader: provider.authHeader,
	};
}

function discoveryUrl(baseUrl, api) {
	const url = new URL(baseUrl);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
	const path = url.pathname.replace(/\/$/, "");
	if (api === "anthropic-messages") url.pathname = `${path.endsWith("/v1") ? path : `${path}/v1`}/models`;
	else if (api === "google-generative-ai") url.pathname = `${path.endsWith("/v1") || path.endsWith("/v1beta") ? path : `${path}/v1beta`}/models`;
	else url.pathname = `${path}/models`;
	return url;
}

function addCredentialCandidate(values, name, value) {
	if (!value) return;
	values.push(value);
	if (name.toLowerCase() === "authorization") {
		const token = value.match(/^\S+\s+(.+)$/)?.[1];
		if (token) values.push(token);
	}
}

async function discoverRoute(provider, route) {
	let url;
	try { url = discoveryUrl(route.baseUrl, route.api); } catch { throw new Error("Provider has an invalid baseUrl"); }

	const headers = {};
	const credentialValues = [];
	for (const [name, value] of Object.entries(route.headers)) {
		const resolved = resolveValue(value);
		if (resolved === undefined) throw new Error("Unable to resolve provider credentials");
		headers[name] = resolved;
		addCredentialCandidate(credentialValues, name, resolved);
	}
	const configuredKey = typeof provider.apiKey === "string" ? provider.apiKey : undefined;
	if (configuredKey) credentialValues.push(configuredKey);
	const nativeHeader = route.api === "anthropic-messages" ? "x-api-key" : route.api === "google-generative-ai" ? "x-goog-api-key" : "authorization";
	if (route.authHeader && !configuredKey) throw new Error("Unable to resolve provider credentials");
	const needsKey = !hasHeader(headers, nativeHeader) || route.authHeader;
	let resolvedKey;
	if (configuredKey && (!configuredKey.startsWith("!") || needsKey)) {
		resolvedKey = resolveValue(configuredKey);
		if (resolvedKey) credentialValues.push(resolvedKey);
	}
	if (needsKey && configuredKey && !resolvedKey) throw new Error("Unable to resolve provider credentials");
	if (resolvedKey) {
		if (!hasHeader(headers, nativeHeader)) {
			if (nativeHeader === "authorization") headers.Authorization = `Bearer ${resolvedKey}`;
			else headers[nativeHeader] = resolvedKey;
		}
		if (route.authHeader) headers.Authorization = `Bearer ${resolvedKey}`;
	}
	if (route.api === "anthropic-messages" && !hasHeader(headers, "anthropic-version")) headers["anthropic-version"] = "2023-06-01";

	let response;
	try {
		response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
	} catch {
		throw new Error("Upstream model discovery failed");
	}
	if (!response.ok || !response.body) throw new Error("Upstream model discovery failed");

	let body;
	try {
		const reader = response.body.getReader();
		const chunks = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 2 * 1024 * 1024) {
				await reader.cancel();
				throw new Error("Upstream model response is too large");
			}
			chunks.push(value);
		}
		body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new Error("Upstream returned invalid model data");
	}
	const entries = route.api === "google-generative-ai" ? body?.models : body?.data;
	if (!Array.isArray(entries)) throw new Error("Upstream returned invalid model data");
	const field = route.api === "google-generative-ai" ? "name" : "id";
	const modelIds = [...new Set(entries.map((item) => item?.[field]).filter((id) => typeof id === "string" && id).map((id) => route.api === "google-generative-ai" ? id.replace(/^models\//, "") : id))].sort();
	if (modelIds.some((id) => credentialValues.some((value) => id.includes(value)))) throw new Error("credential_echo");
	return modelIds;
}

async function discover(providerKey) {
	if (!providerKey) fail("Usage: vendor.mjs discover <provider-key>", 2);
	const provider = readModels()?.providers?.[providerKey];
	if (!provider || typeof provider !== "object" || Array.isArray(provider)) fail("Provider was not found");
	const results = await Promise.all(collectRoutes(provider).map(async (route, index) => {
		try {
			const modelIds = await discoverRoute(provider, route);
			return { routeId: index + 1, api: route.api, status: "ok", count: modelIds.length, modelIds };
		} catch (error) {
			return { routeId: index + 1, api: route.api, status: "error", errorCode: "discovery_failed", credentialEcho: error instanceof Error && error.message === "credential_echo" };
		}
	}));
	if (results.some((result) => result.credentialEcho)) fail("Upstream model discovery failed");
	output({
		source: "upstream-discovery",
		providerKey,
		routes: results.map(({ credentialEcho: _credentialEcho, ...result }) => result),
	});
}

function routeKey(route) {
	const headers = Object.entries(route.headers)
		.map(([name, value]) => [name.toLowerCase(), value])
		.sort(([left], [right]) => left.localeCompare(right));
	return JSON.stringify([route.api, route.baseUrl, headers, route.authHeader === true]);
}

function collectRoutes(provider) {
	if (provider.models !== undefined && !Array.isArray(provider.models)) fail("Provider models must be an array");
	const routes = [];
	const seen = new Set();
	const add = (route) => {
		const key = routeKey(route);
		if (seen.has(key)) return;
		seen.add(key);
		routes.push(route);
	};
	const providerRoute = discoveryRoute(provider);
	for (const api of SUPPORTED_APIS) add({ ...providerRoute, api });
	for (const model of provider.models ?? []) {
		if (typeof model?.id !== "string" || !model.id) continue;
		add(discoveryRoute(provider, model.id));
	}
	return routes;
}


async function readSecret() {
	if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
		process.stderr.write("API key: ");
		let value = "";
		for await (const chunk of process.stdin) value += chunk;
		return value.replace(/[\r\n]+$/, "");
	}
	process.stderr.write("API key: ");
	process.stdin.setRawMode(true);
	process.stdin.resume();
	let value = "";
	try {
		return await new Promise((resolve, reject) => {
			const onData = (chunk) => {
				for (const byte of chunk) {
					if (byte === 3) { process.stdin.off("data", onData); reject(new Error("Cancelled")); return; }
					if (byte === 13 || byte === 10) { process.stdin.off("data", onData); resolve(value); return; }
					if (byte === 127 || byte === 8) { value = value.slice(0, -1); continue; }
					if (byte >= 32) value += String.fromCharCode(byte);
				}
			};
			process.stdin.on("data", onData);
		});
	} finally {
		process.stdin.setRawMode(false);
		process.stdin.pause();
		process.stderr.write("\n");
	}
}

async function setKey(providerKey) {
	if (!providerKey) fail("Usage: vendor.mjs set-key <provider-key>", 2);
	let originalText;
	let models;
	try { originalText = readFileSync(modelsPath, "utf8"); models = JSON.parse(originalText); } catch { fail(`Unable to read ${modelsPath}`); }
	if (!models?.providers?.[providerKey] || typeof models.providers[providerKey] !== "object" || Array.isArray(models.providers[providerKey])) fail(`Provider ${JSON.stringify(providerKey)} was not found`);
	const apiKey = await readSecret();
	if (!apiKey) fail("API key cannot be empty");
	let currentText;
	try { currentText = readFileSync(modelsPath, "utf8"); } catch { fail(`Unable to re-read ${modelsPath}`); }
	if (currentText !== originalText) fail("models.json changed while entering the key; no changes were written. Run the command again.");
	models = JSON.parse(currentText);
	if (!models?.providers?.[providerKey] || typeof models.providers[providerKey] !== "object" || Array.isArray(models.providers[providerKey])) fail(`Provider ${JSON.stringify(providerKey)} was not found`);
	models.providers[providerKey].apiKey = apiKey.replaceAll("$", () => "$$").replace(/^!/, "$!");
	mkdirSync(dirname(modelsPath), { recursive: true });
	const temp = `${modelsPath}.api-key-${randomBytes(16).toString("hex")}.tmp`;
	try {
		writeFileSync(temp, `${JSON.stringify(models, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		renameSync(temp, modelsPath);
	} finally {
		rmSync(temp, { force: true });
	}
	console.log(`Updated apiKey for provider ${JSON.stringify(providerKey)} in ${modelsPath}`);
}

try {
	switch (command) {
		case "catalog": await catalog(args[0], args[1]); break;
		case "discover": await discover(args[0]); break;
		case "set-key": await setKey(args[0]); break;
		default: fail("Usage: vendor.mjs <catalog|discover> [argument]", 2);
	}
} catch (error) {
	if (error instanceof CliError) {
		console.error(error.message);
		process.exitCode = error.code;
	} else {
		throw error;
	}
}

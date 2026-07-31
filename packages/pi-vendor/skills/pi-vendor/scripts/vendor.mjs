#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const [, , command, ...args] = process.argv;
const modelsPath = join(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"), "models.json");

function fail(message, code = 1) {
	console.error(message);
	process.exit(code);
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

function lint() {
	const models = readModels();
	const errors = [];
	if (!models || typeof models !== "object" || Array.isArray(models)) errors.push("root must be an object");
	if (!models?.providers || typeof models.providers !== "object" || Array.isArray(models.providers)) errors.push("providers must be an object");
	for (const [providerIndex, [, provider]] of Object.entries(models?.providers ?? {}).entries()) {
		const path = `providers entry ${providerIndex}`;
		if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
			errors.push(`${path} must be an object`);
			continue;
		}
		const models = provider.models;
		if (models !== undefined && !Array.isArray(models)) {
			errors.push(`${path}.models must be an array`);
			continue;
		}
		const seen = new Set();
		for (const [index, model] of (models ?? []).entries()) {
			if (!model || typeof model !== "object" || Array.isArray(model) || typeof model.id !== "string" || !model.id.trim()) {
				errors.push(`${path}.models[${index}].id must be a non-empty string`);
				continue;
			}
			if (seen.has(model.id)) errors.push(`${path}.models contains a duplicate id`);
			seen.add(model.id);
		}
	}
	output({ valid: errors.length === 0, path: modelsPath, errors });
	if (errors.length) process.exitCode = 1;
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
	if (!query?.trim()) fail("Usage: vendor.mjs catalog <query> [limit]", 2);
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
	const needle = query.toLowerCase();
	const results = [];
	for (const [provider, entries] of Object.entries(models ?? {})) {
		for (const model of Object.values(entries ?? {})) {
			const id = typeof model?.id === "string" ? model.id : "";
			const name = typeof model?.name === "string" ? model.name : "";
			const haystack = `${id}\n${name}`.toLowerCase();
			if (!haystack.includes(needle)) continue;
			const lowerId = id.toLowerCase();
			const score = lowerId === needle ? 0 : lowerId.startsWith(needle) ? 1 : lowerId.includes(needle) ? 2 : 3;
			results.push({ score, provider, model: cleanTemplate(model) });
		}
	}
	results.sort((a, b) => a.score - b.score || a.model.id.localeCompare(b.model.id) || a.provider.localeCompare(b.provider));
	output({ query, count: Math.min(results.length, limit), total: results.length, results: results.slice(0, limit).map(({ provider, model }) => ({ provider, model })) });
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
			fail("Unable to resolve provider credentials");
		}
	}
	return resolveTemplate(value);
}

async function discover(providerKey) {
	if (!providerKey) fail("Usage: vendor.mjs discover <provider-key>", 2);
	const provider = readModels()?.providers?.[providerKey];
	if (!provider || typeof provider !== "object" || Array.isArray(provider)) fail(`Provider ${JSON.stringify(providerKey)} was not found`);
	let url;
	try {
		url = new URL(provider.baseUrl);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
		url.pathname = `${url.pathname.replace(/\/$/, "")}/models`;
	} catch {
		fail("Provider has an invalid baseUrl");
	}
	const headers = {};
	const credentialValues = [];
	for (const [name, value] of Object.entries(provider.headers ?? {})) {
		const resolved = resolveValue(value);
		if (resolved === undefined) fail("Unable to resolve provider credentials");
		headers[name] = resolved;
		if (resolved) {
			credentialValues.push(resolved);
			if (name.toLowerCase() === "authorization") {
				const token = resolved.match(/^\S+\s+(.+)$/)?.[1];
				if (token) credentialValues.push(token);
			}
		}
	}
	const configuredKey = typeof provider.apiKey === "string" ? provider.apiKey : undefined;
	if (configuredKey) credentialValues.push(configuredKey);
	const hasAuthorization = Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
	let resolvedKey;
	if (configuredKey && (!configuredKey.startsWith("!") || !hasAuthorization)) {
		resolvedKey = resolveValue(configuredKey);
		if (resolvedKey) credentialValues.push(resolvedKey);
	}
	if (!hasAuthorization && resolvedKey) headers.Authorization = `Bearer ${resolvedKey}`;
	let response;
	try {
		response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
	} catch {
		fail("Upstream model discovery failed");
	}
	if (!response.ok || !response.body) fail("Upstream model discovery failed");
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
				fail("Upstream model response is too large");
			}
			chunks.push(value);
		}
		body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		fail("Upstream returned invalid model data");
	}
	const modelIds = [...new Set((Array.isArray(body?.data) ? body.data : []).map((item) => item?.id).filter((id) => typeof id === "string" && id))].sort();
	if (modelIds.some((id) => credentialValues.some((value) => id.includes(value)))) fail("Upstream model discovery failed");
	output({ providerKey, count: modelIds.length, modelIds });
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

switch (command) {
	case "catalog": await catalog(args[0], args[1]); break;
	case "discover": await discover(args[0]); break;
	case "lint": lint(); break;
	case "set-key": await setKey(args[0]); break;
	default: fail("Usage: vendor.mjs <catalog|discover|lint|set-key> [arguments]", 2);
}

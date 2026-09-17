#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { delimiter, basename, dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

function shimRoots(entry) {
	// mise/aube "bin shims" are small shell scripts whose text references the real package
	// location (e.g. target=../.mise/@earendil-works+pi-coding-agent@<version>/...).
	if (!entry || !existsSync(entry)) return [];
	let stat;
	try { stat = statSync(entry); } catch { return []; }
	if (!stat.isFile() || stat.size > 262144) return [];
	let text;
	try { text = readFileSync(entry, "utf8"); } catch { return []; }
	let base;
	try { base = dirname(realpathSync(entry)); } catch { return []; }
	const roots = [];
	const seen = new Set();
	const tokens = text.match(/[^\s'"`]*node_modules[\\/]@earendil-works[\\/]pi-coding-agent[^\s'"`]*/g) ?? [];
	for (const token of tokens) {
		for (const candidate of [token, token.replace(/^\$\{?basedir\}?/, base), token.replace(/^%~dp0/i, base), resolve(base, token)]) {
			const root = packageRoot(candidate);
			if (root && !seen.has(root)) { seen.add(root); roots.push(root); }
		}
	}
	return roots;
}

function miseRoots(entry) {
	// mise npm installs place the package under <prefix>/node_modules/.mise/@earendil-works+pi-coding-agent@<version>/.
	if (!entry || !existsSync(entry)) return [];
	const binDir = dirname(entry);
	if (basename(binDir) !== ".bin") return [];
	let names;
	try { names = readdirSync(join(dirname(binDir), ".mise")); } catch { return []; }
	const roots = [];
	for (const name of names) {
		if (!/^@earendil-works\+pi-coding-agent@/.test(name)) continue;
		const root = join(dirname(binDir), ".mise", name, "node_modules", "@earendil-works", "pi-coding-agent");
		if (existsSync(join(root, "package.json"))) roots.push(root);
	}
	return roots;
}

function catalogPaths() {
	const roots = new Set();
	if (process.env.PI_VENDOR_PI_ROOT) roots.add(process.env.PI_VENDOR_PI_ROOT);
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		for (const name of ["pi", "pi.cmd", "pi.exe"]) {
			const entry = join(dir, name);
			const root = packageRoot(entry);
			if (root) roots.add(root);
			for (const shimRoot of shimRoots(entry)) roots.add(shimRoot);
			for (const miseRoot of miseRoots(entry)) roots.add(miseRoot);
		}
		// npm's Windows shim lives beside node_modules rather than inside the package.
		roots.add(join(dir, "node_modules", "@earendil-works", "pi-coding-agent"));
	}
	const paths = [];
	for (const root of roots) {
		paths.push(join(root, "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"));
		paths.push(join(root, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"));
		// Hoisted installs keep pi-ai beside the pi-coding-agent package in the same scope.
		paths.push(join(root, "..", "pi-ai", "dist", "models.generated.js"));
	}
	return paths;
}

function cleanTemplate(model) {
	const copy = structuredClone(model);
	for (const field of ["provider", "baseUrl", "headers", "apiKey", "authHeader"]) delete copy[field];
	return copy;
}

async function officialModels() {
	const path = catalogPaths().find(existsSync);
	if (!path) fail("Official catalog is unavailable; set PI_VENDOR_PI_ROOT to the install prefix that contains node_modules/@earendil-works/pi-ai");
	try {
		return (await import(pathToFileURL(path).href)).MODELS;
	} catch {
		fail("Official catalog is unavailable; set PI_VENDOR_PI_ROOT to the install prefix that contains node_modules/@earendil-works/pi-ai");
	}
}

async function catalog(query, limitText) {
	if (!query?.trim()) fail("Usage: vendor.mjs catalog <keyword> [limit]", 2);
	if (Buffer.byteLength(query) > 512) fail("Query exceeds 512 bytes", 2);
	const limit = limitText === undefined ? 50 : Number(limitText);
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("Limit must be an integer from 1 to 100", 2);
	const models = await officialModels();
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

const DRIFT_EXCLUDED_FIELDS = new Set(["id", "provider", "api", "baseUrl", "headers", "apiKey", "authHeader"]);

function leafEntries(value, path = "", out = []) {
	if (value === undefined || value === null) return out;
	if (typeof value !== "object" || Array.isArray(value)) { out.push([path, value]); return out; }
	for (const [key, child] of Object.entries(value)) {
		if (!path && DRIFT_EXCLUDED_FIELDS.has(key)) continue;
		leafEntries(child, path ? `${path}.${key}` : key, out);
	}
	return out;
}

function stableStringify(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function diffFields(model, template) {
	const configuredLeaves = leafEntries(model);
	const officialLeaves = leafEntries(template);
	const configuredMap = new Map(configuredLeaves);
	const officialMap = new Map(officialLeaves);
	const differences = [];
	for (const field of new Set([...configuredMap.keys(), ...officialMap.keys()])) {
		const configured = configuredMap.get(field);
		const official = officialMap.get(field);
		if (stableStringify(configured) === stableStringify(official)) continue;
		differences.push({ field, configured: configured === undefined ? null : configured, official: official === undefined ? null : official });
	}
	differences.sort((left, right) => left.field.localeCompare(right.field));
	return differences;
}

function catalogMatches(models, id) {
	const matches = [];
	for (const [slug, entries] of Object.entries(models ?? {})) {
		for (const template of Object.values(entries ?? {})) {
			if (template?.id === id && !matches.some((match) => match.officialProvider === slug)) {
				matches.push({ officialProvider: slug, officialId: id, matchType: "exact", template });
			}
		}
	}
	const slash = id.indexOf("/");
	if (slash > 0) {
		const vendor = id.slice(0, slash);
		const officialId = id.slice(slash + 1);
		for (const template of Object.values(models?.[vendor] ?? {})) {
			if (template?.id === officialId && !matches.some((match) => match.officialProvider === vendor)) {
				matches.push({ officialProvider: vendor, officialId, matchType: "vendor", template });
			}
		}
	}
	return matches;
}

async function drift(providerKey, restrictArg) {
	if (!providerKey) fail("Usage: vendor.mjs drift <provider-key> [official-provider,...]", 2);
	const provider = readModels()?.providers?.[providerKey];
	if (!provider || typeof provider !== "object" || Array.isArray(provider)) fail("Provider was not found");
	if (provider.models !== undefined && !Array.isArray(provider.models)) fail("Provider models must be an array");
	const models = await officialModels();
	const restrict = restrictArg ? new Set(restrictArg.split(",").map((slug) => slug.trim()).filter(Boolean)) : null;
	const results = [];
	const noOfficialMatch = [];
	let drifted = 0;
	let upToDate = 0;
	for (const model of provider.models ?? []) {
		const id = typeof model?.id === "string" ? model.id : "";
		if (!id) continue;
		let matches = catalogMatches(models, id);
		if (restrict) matches = matches.filter((match) => restrict.has(match.officialProvider));
		if (matches.length === 0) { noOfficialMatch.push(id); continue; }
		const withDifferences = matches.map((match) => ({
			officialProvider: match.officialProvider,
			officialId: match.officialId,
			matchType: match.matchType,
			differences: diffFields(model, match.template),
		}));
		// A configuration copied from an official template is up to date as long as it still
		// equals at least one current template exactly; differences against other sources are noise.
		if (withDifferences.some((match) => match.differences.length === 0)) { upToDate += 1; continue; }
		drifted += 1;
		results.push({ id, matches: withDifferences });
	}
	output({
		source: "official-catalog-drift",
		providerKey,
		restrictedTo: restrict ? [...restrict] : null,
		checked: results.length + upToDate + noOfficialMatch.length,
		drifted,
		upToDate,
		noOfficialMatch,
		models: results,
	});
	const rows = results.flatMap((entry) => entry.matches.flatMap((match) => match.differences.map((difference) => `| ${entry.id} | ${match.officialProvider} (${match.officialId}) | ${difference.field} | ${difference.configured === null ? "missing" : JSON.stringify(difference.configured)} | ${difference.official === null ? "missing" : JSON.stringify(difference.official)} |`)));
	console.log("");
	console.log("#### Official template drift (machine-generated; every update still needs user confirmation)");
	if (rows.length === 0) console.log("Every configured model still matches at least one current official template exactly.");
	else {
		console.log("| model id | official source | field | configured | official |");
		console.log("|---|---|---|---|---|");
		for (const row of rows) console.log(row);
	}
	if (upToDate > 0) console.log(`\nUp to date against at least one matched official source: ${upToDate} model(s).`);
	if (noOfficialMatch.length > 0) console.log(`\nNo matching official catalog entry${restrict ? " under the selected source(s)" : ""} found for: ${noOfficialMatch.join(", ")}.`);
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
		case "drift": await drift(args[0], args[1]); break;
		case "set-key": await setKey(args[0]); break;
		default: fail("Usage: vendor.mjs <catalog|discover|drift> [argument]", 2);
	}
} catch (error) {
	if (error instanceof CliError) {
		console.error(error.message);
		process.exitCode = error.code;
	} else {
		throw error;
	}
}

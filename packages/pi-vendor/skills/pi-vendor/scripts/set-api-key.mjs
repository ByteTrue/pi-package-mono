#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const providerKey = process.argv[2];
if (!providerKey) {
	console.error("Usage: node set-api-key.mjs <provider-key>");
	process.exit(2);
}

const path = join(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"), "models.json");

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
					if (byte === 3) {
						process.stdin.off("data", onData);
						reject(new Error("Cancelled"));
						return;
					}
					if (byte === 13 || byte === 10) {
						process.stdin.off("data", onData);
						resolve(value);
						return;
					}
					if (byte === 127 || byte === 8) {
						value = value.slice(0, -1);
						continue;
					}
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

let originalText;
let models;
try {
	originalText = readFileSync(path, "utf8");
	models = JSON.parse(originalText);
} catch {
	console.error(`Unable to read ${path}`);
	process.exit(1);
}

const provider = models?.providers?.[providerKey];
if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
	console.error(`Provider "${providerKey}" was not found in ${path}`);
	process.exit(1);
}

const apiKey = await readSecret();
if (!apiKey) {
	console.error("API key cannot be empty");
	process.exit(1);
}
let currentText;
try {
	currentText = readFileSync(path, "utf8");
} catch {
	console.error(`Unable to re-read ${path}`);
	process.exit(1);
}
if (currentText !== originalText) {
	console.error("models.json changed while entering the key; no changes were written. Run the command again.");
	process.exit(1);
}
models = JSON.parse(currentText);
const currentProvider = models?.providers?.[providerKey];
if (!currentProvider || typeof currentProvider !== "object" || Array.isArray(currentProvider)) {
	console.error(`Provider "${providerKey}" was not found in ${path}`);
	process.exit(1);
}
const encodedApiKey = apiKey.replaceAll("$", () => "$$").replace(/^!/, "$!");
currentProvider.apiKey = encodedApiKey;

mkdirSync(dirname(path), { recursive: true });
const temp = `${path}.api-key-${randomBytes(16).toString("hex")}.tmp`;
try {
	writeFileSync(temp, `${JSON.stringify(models, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(temp, path);
} finally {
	rmSync(temp, { force: true });
}
console.log(`Updated apiKey for provider "${providerKey}" in ${path}`);

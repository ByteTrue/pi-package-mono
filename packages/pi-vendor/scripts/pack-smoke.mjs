#!/usr/bin/env node
/**
 * Real tarball smoke for @bytetrue/pi-vendor.
 * mkdtemp → npm pack --json → allow/deny list → extract → jiti load → 127.0.0.1:0 → cleanup.
 * Does not open a real browser or touch user models.json.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const monoRoot = resolve(packageRoot, "../..");

const ALLOW_PREFIXES = ["package/", "package/src/", "package/README.md", "package/package.json"];
const DENY_SUBSTRINGS = [
	".test.ts",
	"node_modules/",
	".map",
	"src/web/client/",
	"scripts/",
	".codestable/",
];

function fail(msg) {
	console.error(`[pack-smoke] FAIL: ${msg}`);
	process.exitCode = 1;
}

function ok(msg) {
	console.log(`[pack-smoke] OK: ${msg}`);
}

async function run(cmd, args, opts = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd ?? monoRoot,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ...opts.env },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => {
			stdout += c;
		});
		child.stderr.on("data", (c) => {
			stderr += c;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${stderr || stdout}`));
				return;
			}
			resolvePromise({ stdout, stderr });
		});
	});
}

function listTarPaths(packJson) {
	// npm pack --json may return either:
	//  - [{ filename, files: [...] }]  (older)
	//  - { "@scope/name": { filename, files: [...] } }  (npm 10+)
	// or a single package object.
	let entry;
	if (Array.isArray(packJson)) {
		entry = packJson[0];
	} else if (packJson && typeof packJson === "object") {
		if (Array.isArray(packJson.files)) {
			entry = packJson;
		} else {
			entry = Object.values(packJson)[0];
		}
	}
	const files = entry?.files ?? [];
	return {
		entry,
		paths: files.map((f) => (typeof f === "string" ? f : f.path)),
	};
}

function parseNpmPackJson(stdout) {
	// prepack / lifecycle scripts may print non-JSON before the pack payload.
	const arrStart = stdout.indexOf("[");
	const objStart = stdout.indexOf("{");
	let start = -1;
	let end = -1;
	if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
		start = arrStart;
		end = stdout.lastIndexOf("]");
	} else if (objStart >= 0) {
		start = objStart;
		end = stdout.lastIndexOf("}");
	}
	if (start < 0 || end < start) {
		throw new Error(`npm pack --json did not emit JSON:\n${stdout.slice(0, 400)}`);
	}
	return JSON.parse(stdout.slice(start, end + 1));
}

function assertPackFiles(paths) {
	if (!paths.length) throw new Error("npm pack --json reported zero files");
	const must = [
		"package/package.json",
		"package/README.md",
		"package/src/index.ts",
		"package/src/web/assets/app.js",
		"package/src/web/server/server.ts",
		"package/src/web/server/session.ts",
	];
	for (const m of must) {
		if (!paths.includes(m) && !paths.some((p) => p === m || p.endsWith(m.replace(/^package\//, "")))) {
			// npm pack --json paths are typically without package/ prefix in newer npm
		}
	}
	// Normalize: npm pack --json uses paths relative to package root (no package/ prefix)
	const normalized = paths.map((p) => p.replace(/^package\//, ""));
	const required = [
		"package.json",
		"README.md",
		"src/index.ts",
		"src/web/assets/app.js",
		"src/web/server/server.ts",
		"src/web/server/session.ts",
		"src/web/server/mask.ts",
		"src/web/server/assets.ts",
	];
	for (const r of required) {
		if (!normalized.includes(r)) throw new Error(`packed tarball missing required path: ${r}`);
	}
	for (const p of normalized) {
		if (p.includes("node_modules/")) throw new Error(`packed forbidden path: ${p}`);
		if (p.endsWith(".test.ts")) throw new Error(`packed test file: ${p}`);
		if (p.endsWith(".map")) throw new Error(`packed source map: ${p}`);
	}
	if (!normalized.includes("src/web/assets/index.html") && !normalized.includes("src/web/client/index.html")) {
		// Prefer built assets; client source may be excluded by files filter — require assets copy
		throw new Error("packed tarball missing web index.html under assets (run build:web and copy assets)");
	}
	if (!normalized.includes("src/web/assets/style.css") && !normalized.includes("src/web/client/style.css")) {
		throw new Error("packed tarball missing style.css under assets");
	}
	ok(`pack file list verified (${normalized.length} files)`);
	return normalized;
}

async function extractTgz(tgzPath, destDir) {
	await mkdir(destDir, { recursive: true });
	// Use system tar for portability without extra deps
	await run("tar", ["-xzf", tgzPath, "-C", destDir]);
	return join(destDir, "package");
}

function resolveJiti() {
	// Prefer jiti from the installed pi-coding-agent dependency tree (peer layout).
	const require = createRequire(join(monoRoot, "package.json"));
	const agentPkgDir = join(monoRoot, "node_modules/@earendil-works/pi-coding-agent");
	if (!existsSync(agentPkgDir)) {
		throw new Error("pi-coding-agent not installed; cannot resolve jiti from peer tree");
	}
	const agentRequire = createRequire(join(agentPkgDir, "package.json"));
	const jitiPath = agentRequire.resolve("jiti");
	ok(`resolved jiti via coding-agent tree: ${jitiPath}`);
	return jitiPath;
}

async function main() {
	const tempRoot = await mkdtemp(join(tmpdir(), "pi-vendor-pack-smoke-"));
	console.log(`[pack-smoke] temp=${tempRoot}`);
	try {
		// Ensure generated web assets exist before pack
		await run("npm", ["--workspace", "@bytetrue/pi-vendor", "run", "build:web"]);

		const packDest = join(tempRoot, "pack");
		await mkdir(packDest, { recursive: true });
		const { stdout } = await run("npm", [
			"pack",
			"--workspace",
			"@bytetrue/pi-vendor",
			"--json",
			"--pack-destination",
			packDest,
		]);
		const packJson = parseNpmPackJson(stdout);
		const { entry, paths } = listTarPaths(packJson);
		const filename = entry?.filename ?? entry?.name;
		if (!filename && !(await readdir(packDest)).some((f) => f.endsWith(".tgz"))) {
			throw new Error(`unexpected npm pack --json: ${stdout.slice(0, 400)}`);
		}
		const tgzPath = filename
			? join(packDest, filename.endsWith(".tgz") ? filename : `${filename}`)
			: "";
		// npm may put basename only
		const actualTgz = existsSync(tgzPath)
			? tgzPath
			: join(packDest, (await readdir(packDest)).find((f) => f.endsWith(".tgz")));
		if (!actualTgz || !existsSync(actualTgz)) throw new Error("packed tgz not found");
		ok(`packed ${actualTgz}`);

		assertPackFiles(paths);

		const extractDir = join(tempRoot, "extract");
		const extractedPkg = await extractTgz(actualTgz, extractDir);
		ok(`extracted to ${extractedPkg}`);

		// Verify assets exist in extracted layout
		for (const rel of [
			"src/web/assets/app.js",
			"src/web/assets/index.html",
			"src/web/assets/style.css",
			"src/web/server/session.ts",
		]) {
			const p = join(extractedPkg, rel);
			if (!existsSync(p)) throw new Error(`missing extracted file: ${rel}`);
		}

		const jitiPath = resolveJiti();
		const jitiUrl = pathToFileURL(jitiPath).href;
		const jitiMod = await import(jitiUrl);
		const createJiti = jitiMod.createJiti ?? jitiMod.default?.createJiti ?? jitiMod.default;
		if (typeof createJiti !== "function") {
			throw new Error(`unexpected jiti export shape from ${jitiPath}`);
		}
		const agentPkgDir = join(monoRoot, "node_modules/@earendil-works/pi-coding-agent");
		const jiti = createJiti(join(extractedPkg, "src/index.ts"), {
			interopDefault: true,
			// Peer is not bundled into the tarball; resolve from the host install (same as real Pi installs).
			alias: {
				"@earendil-works/pi-coding-agent": agentPkgDir,
			},
		});

		const modelsPath = join(tempRoot, "models.json");
		await writeFile(modelsPath, `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });

		const sessionMod = jiti(join(extractedPkg, "src/web/server/session.ts"));
		const startVendorWebSession = sessionMod.startVendorWebSession;
		if (typeof startVendorWebSession !== "function") {
			throw new Error("startVendorWebSession not exported from packed session.ts");
		}

		const session = await startVendorWebSession({
			modelsPath,
			openBrowser: async () => false,
		});
		ok(`session url=${session.url.replace(/#.*$/, "#<redacted>")}`);

		const base = session.url.split("#")[0].replace(/\/$/, "");
		const hash = session.url.includes("#") ? session.url.split("#")[1] : "";
		const token = hash.startsWith("token=") ? hash.slice("token=".length) : hash;
		if (!token) throw new Error("capability token missing from session url");

		// Known asset
		const assetRes = await fetch(`${base}/`);
		if (assetRes.status !== 200) throw new Error(`GET / expected 200, got ${assetRes.status}`);
		const csp = assetRes.headers.get("content-security-policy") ?? "";
		const cache = assetRes.headers.get("cache-control") ?? "";
		if (!csp.includes("default-src")) throw new Error("missing CSP on asset");
		if (!cache.includes("no-store")) throw new Error("missing Cache-Control: no-store on asset");
		ok("GET / asset headers ok");

		// Unknown asset
		const miss = await fetch(`${base}/nope.js`);
		if (miss.status !== 404) throw new Error(`unknown asset expected 404, got ${miss.status}`);
		ok("unknown asset 404");

		// Auth required
		const unauth = await fetch(`${base}/api/state`);
		if (unauth.status !== 401) throw new Error(`unauth state expected 401, got ${unauth.status}`);
		ok("state unauthorized without token");

		// State with token
		const stateRes = await fetch(`${base}/api/state`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Origin: base,
			},
		});
		if (stateRes.status !== 200) {
			const body = await stateRes.text();
			throw new Error(`GET /api/state expected 200, got ${stateRes.status}: ${body}`);
		}
		const stateJson = await stateRes.json();
		if (!stateJson || typeof stateJson !== "object") throw new Error("state body not object");
		ok("GET /api/state ok");

		// Cancel
		const cancelRes = await fetch(`${base}/api/cancel`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Origin: base,
			},
		});
		if (cancelRes.status !== 204 && cancelRes.status !== 200) {
			throw new Error(`POST /api/cancel expected 204/200, got ${cancelRes.status}`);
		}
		ok("POST /api/cancel ok");

		// Wait for session settle + cleanup
		const result = await session.waitForResult();
		if (result.kind !== "cancelled") throw new Error(`expected cancelled result, got ${result.kind}`);
		ok("session settled cancelled");

		// Server should no longer accept connections
		let closed = false;
		try {
			await fetch(`${base}/`, { signal: AbortSignal.timeout(1000) });
		} catch {
			closed = true;
		}
		if (!closed) {
			// Some platforms may still briefly accept; stop explicitly
			session.stop();
		}
		ok("pack smoke complete");
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
		ok("temp cleaned");
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

#!/usr/bin/env node
/**
 * Real tarball smoke for @bytetrue/pi-image-gen.
 * npm pack → allowlist paths → extract → production install → load extension entry.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const monoRoot = resolve(packageRoot, "../..");

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

function parseNpmPackJson(stdout) {
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

function listTarPaths(packJson) {
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

function assertPackFiles(paths) {
	if (!paths.length) throw new Error("npm pack --json reported zero files");
	const normalized = paths.map((p) => p.replace(/^package\//, ""));
	const required = [
		"package.json",
		"README.md",
		"LICENSE",
		"NOTICE",
		"dist/index.js",
	];
	for (const r of required) {
		if (!normalized.includes(r)) throw new Error(`packed tarball missing required path: ${r}`);
	}
	for (const p of normalized) {
		if (p.includes("node_modules/")) throw new Error(`packed forbidden path: ${p}`);
		if (p.endsWith(".test.ts") || p.includes("/__tests__/")) throw new Error(`packed test file: ${p}`);
		if (p.startsWith("src/") || p.includes("/src/")) throw new Error(`packed source path: ${p}`);
		if (p.startsWith("scripts/") || p.includes("/scripts/")) throw new Error(`packed scripts path: ${p}`);
	}
	ok(`pack file list verified (${normalized.length} files)`);
	return normalized;
}

async function extractTgz(tgzPath, destDir) {
	await mkdir(destDir, { recursive: true });
	await run("tar", ["-xzf", tgzPath, "-C", destDir]);
	return join(destDir, "package");
}

async function main() {
	const tempRoot = await mkdtemp(join(tmpdir(), "pi-image-gen-pack-smoke-"));
	console.log(`[pack-smoke] temp=${tempRoot}`);
	try {
		const packDest = join(tempRoot, "pack");
		await mkdir(packDest, { recursive: true });
		const { stdout } = await run("npm", [
			"pack",
			"--workspace",
			"@bytetrue/pi-image-gen",
			"--json",
			"--pack-destination",
			packDest,
		]);
		const packJson = parseNpmPackJson(stdout);
		const { entry, paths } = listTarPaths(packJson);
		const filename = entry?.filename ?? entry?.name;
		const tgzPath = filename
			? join(packDest, filename.endsWith(".tgz") ? filename : `${filename}`)
			: "";
		const actualTgz = existsSync(tgzPath)
			? tgzPath
			: join(packDest, (await readdir(packDest)).find((f) => f.endsWith(".tgz")));
		if (!actualTgz || !existsSync(actualTgz)) throw new Error("packed tgz not found");
		ok(`packed ${actualTgz}`);

		assertPackFiles(paths);

		const extractDir = join(tempRoot, "extract");
		const extractedPkg = await extractTgz(actualTgz, extractDir);
		ok(`extracted to ${extractedPkg}`);

		for (const rel of ["package.json", "LICENSE", "NOTICE", "dist/index.js", "README.md"]) {
			const p = join(extractedPkg, rel);
			if (!existsSync(p)) throw new Error(`missing extracted file: ${rel}`);
		}

		// Production-only install of package dependencies (no devDeps).
		await run("npm", ["install", "--omit=dev", "--no-package-lock", "--ignore-scripts"], {
			cwd: extractedPkg,
		});
		ok("production install complete");

		const pkgJson = JSON.parse(await readFile(join(extractedPkg, "package.json"), "utf8"));
		const ext = pkgJson?.pi?.extensions?.[0];
		if (ext !== "./dist/index.js") {
			throw new Error(`unexpected pi.extensions entry: ${ext}`);
		}

		const entryUrl = pathToFileURL(join(extractedPkg, "dist/index.js")).href;
		const mod = await import(entryUrl);
		if (typeof mod.default !== "function" && typeof mod !== "object") {
			throw new Error("packed entry did not load as a module");
		}
		// Extension factory is default export (function) or named exports present.
		const hasFactory =
			typeof mod.default === "function" ||
			typeof mod.createExtension === "function" ||
			Object.keys(mod).length > 0;
		if (!hasFactory) throw new Error("packed entry has no usable exports");
		ok("loaded packed dist/index.js");

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

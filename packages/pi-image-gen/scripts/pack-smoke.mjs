#!/usr/bin/env node
/**
 * Real tarball smoke for @bytetrue/pi-image-gen.
 * npm pack → allowlist paths → extract → production install → load extension entry.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const monoRoot = resolve(packageRoot, "../..");

function ok(msg) {
	console.log(`[pack-smoke] OK: ${msg}`);
}

const execFileAsync = promisify(execFile);

function run(command, args, { cwd = monoRoot } = {}) {
	return execFileAsync(command, args, { cwd, encoding: "utf8" });
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
		"dist/cli.js",
		"skills/pi-image-gen/SKILL.md",
		"skills/pi-image-gen/scripts/image-gen.mjs",
	];
	for (const r of required) {
		if (!normalized.includes(r)) throw new Error(`packed tarball missing required path: ${r}`);
	}
	for (const p of normalized) {
		if (p.includes("node_modules/")) throw new Error(`packed forbidden path: ${p}`);
		if (p.endsWith(".test.ts") || p.includes("/__tests__/")) throw new Error(`packed test file: ${p}`);
		if (p.startsWith("src/") || p.includes("/src/")) throw new Error(`packed source path: ${p}`);
		if (p.startsWith("scripts/")) throw new Error(`packed package-maintenance script: ${p}`);
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
		const packJson = JSON.parse(stdout);
		const entry = Array.isArray(packJson) ? packJson[0] : Object.values(packJson)[0];
		if (!entry?.filename || !Array.isArray(entry.files)) {
			throw new Error("npm pack --json returned an unexpected result");
		}
		const actualTgz = join(packDest, entry.filename);
		if (!existsSync(actualTgz)) throw new Error("packed tgz not found");
		ok(`packed ${actualTgz}`);

		assertPackFiles(entry.files.map((file) => file.path));

		const extractDir = join(tempRoot, "extract");
		const extractedPkg = await extractTgz(actualTgz, extractDir);
		ok(`extracted to ${extractedPkg}`);

		for (const rel of [
			"package.json",
			"LICENSE",
			"NOTICE",
			"dist/index.js",
			"dist/cli.js",
			"skills/pi-image-gen/SKILL.md",
			"skills/pi-image-gen/scripts/image-gen.mjs",
			"README.md",
		]) {
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
		const skills = pkgJson?.pi?.skills;
		if (!Array.isArray(skills) || !skills.includes("./skills")) {
			throw new Error(`unexpected pi.skills entry: ${JSON.stringify(skills)}`);
		}
		const entryUrl = pathToFileURL(join(extractedPkg, "dist/index.js")).href;
		const mod = await import(entryUrl);

		const registeredTools = [];
		const registeredCommands = [];
		mod.default({
			registerTool: (tool) => registeredTools.push(tool.name),
			registerCommand: (name) => registeredCommands.push(name),
			on: () => {},
		});
		if (registeredTools.length !== 0) throw new Error(`unexpected packed tools: ${registeredTools.join(", ")}`);
		if (!registeredCommands.includes("image-gen")) throw new Error("packed extension did not register /image-gen");
		ok("loaded packed dist/index.js without an Agent tool");
		await run("node", [join(extractedPkg, "skills/pi-image-gen/scripts/image-gen.mjs"), "--help"], {
			cwd: extractedPkg,
		});
		ok("packed Skill CLI wrapper runs");

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

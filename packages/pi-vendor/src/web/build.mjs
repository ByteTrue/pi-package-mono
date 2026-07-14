import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));
const outdir = join(baseDir, "assets");
const clientDir = join(baseDir, "client");

mkdirSync(outdir, { recursive: true });

const result = await esbuild.build({
	entryPoints: [join(clientDir, "app.ts")],
	bundle: true,
	minify: true,
	outfile: join(outdir, "app.js"),
	format: "esm",
	target: "es2022",
	platform: "browser",
	metafile: true,
});

if (result.errors.length > 0) {
	console.error("esbuild errors:", result.errors);
	process.exit(1);
}

// Pack smoke and static server resolve HTML/CSS from the assets directory only.
copyFileSync(join(clientDir, "index.html"), join(outdir, "index.html"));
copyFileSync(join(clientDir, "style.css"), join(outdir, "style.css"));

console.log(
	`web assets built → ${outdir}/app.js (+ index.html, style.css; ${result.metafile ? Object.keys(result.metafile.outputs).length : "?"} esbuild outputs)`,
);
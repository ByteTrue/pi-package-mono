import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const webDir = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(webDir, "client");
const assetDir = resolve(webDir, "assets");

await rm(assetDir, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(clientDir, "app.ts")],
  outdir: assetDir,
  entryNames: "app",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  legalComments: "none",
  sourcemap: false,
});

await cp(resolve(clientDir, "index.html"), resolve(assetDir, "index.html"));

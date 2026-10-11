#!/usr/bin/env node
/**
 * pi-dev-setup — configure project-level Pi for developing this repo's packages.
 *
 * Idempotent. Writes only inside the repo:
 *   - .pi/settings.json  : every packages/* workspace with a "pi" field gets a
 *     local path entry plus an npm-source shadow entry (autoload:false, all
 *     resource kinds "!**") so a globally installed package of the same name
 *     yields to the local source checkout.
 *   - .pi/extensions/    : every small-extensions single-file .ts (the main
 *     file listed in its package.json "files") is copied in.
 *
 * Existing .pi/settings.json fields other than "packages" are preserved.
 * Nothing outside the repo is touched. Restart or /reload Pi afterwards.
 */

import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const piDir = join(repoRoot, ".pi");
const settingsPath = join(piDir, "settings.json");
const extensionsDir = join(piDir, "extensions");

/** Shadow entry that silences a globally installed package of the same name. */
function shadowEntry(pkgName) {
  return {
    source: `npm:${pkgName}`,
    autoload: false,
    extensions: ["!**"],
    skills: ["!**"],
    prompts: ["!**"],
    themes: ["!**"],
  };
}

function toPosix(p) {
  return sep === "\\" ? p.split(sep).join("/") : p;
}

// 1. Collect workspace packages that declare a Pi manifest.
const packagesDir = join(repoRoot, "packages");
const piPackages = [];
for (const entry of readdirSync(packagesDir).sort()) {
  const pkgPath = join(packagesDir, entry);
  if (!statSync(pkgPath).isDirectory()) continue;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(pkgPath, "package.json"), "utf8"));
  } catch {
    continue;
  }
  if (pkg.pi && pkg.name) {
    piPackages.push({ dir: entry, name: pkg.name });
  }
}
if (piPackages.length === 0) {
  console.error("error: no packages/*/package.json with a 'pi' field found");
  process.exit(1);
}

// 2. Write .pi/settings.json — path entries + npm shadow entries, keep other fields.
mkdirSync(piDir, { recursive: true });
let settings = {};
try {
  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
} catch {
  // absent or malformed: rebuild from scratch
}
const packages = [];
for (const { dir, name } of piPackages) {
  packages.push(toPosix(relative(piDir, join(packagesDir, dir))));
}
for (const { name } of piPackages) {
  packages.push(shadowEntry(name));
}
settings.packages = packages;
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

// 3. Copy small extensions into .pi/extensions/.
const smallDir = join(repoRoot, "small-extensions");
const copied = [];
if (statSync(smallDir, { throwIfNoEntry: false })) {
  mkdirSync(extensionsDir, { recursive: true });
  // The dir is generated state: remove stale copies of files no longer shipped.
  rmSync(extensionsDir, { recursive: true, force: true });
  mkdirSync(extensionsDir, { recursive: true });
  for (const entry of readdirSync(smallDir).sort()) {
    const extDir = join(smallDir, entry);
    if (!statSync(extDir).isDirectory()) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(extDir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    for (const file of pkg.files ?? []) {
      if (typeof file === "string" && file.endsWith(".ts") && !file.endsWith(".test.ts")) {
        cpSync(join(extDir, file), join(extensionsDir, file));
        copied.push(file);
      }
    }
  }
}

// 4. Report.
console.log(`Wrote ${toPosix(relative(repoRoot, settingsPath))} (${piPackages.length} local package entries + ${piPackages.length} npm shadow entries):`);
for (const { name } of piPackages) console.log(`  - ${name}`);
if (copied.length > 0) {
  console.log(`Copied small extensions into ${toPosix(relative(repoRoot, extensionsDir))}/:`);
  for (const file of copied) console.log(`  - ${file}`);
} else {
  console.log("No small extensions found.");
}
console.log("Restart or /reload Pi to apply. Make sure 'npm ci' has run in this worktree (packages load TS source via jiti and need node_modules present).");

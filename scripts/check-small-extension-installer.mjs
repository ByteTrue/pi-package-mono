#!/usr/bin/env node
// Small-extension install-channel gate.
//
// scripts/install-small-extension.mjs is how small extensions reach a user's machine;
// an extension missing from its EXTENSIONS list can never be installed by the documented
// command, and the failure is silent. Fails when a small-extensions/ directory is not in
// the installer's list, or the installer lists a source file that does not exist.
//
// Runs in CI (ci.yml) and locally: node scripts/check-small-extension-installer.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const installer = readFileSync(join(repoRoot, 'scripts', 'install-small-extension.mjs'), 'utf8');

const names = readdirSync(join(repoRoot, 'small-extensions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const errors = [];
for (const name of names) {
  if (!installer.includes(`small-extensions/${name}/`)) {
    errors.push(`installer does not list small extension ${name}`);
  }
}
for (const [, source] of installer.matchAll(/'(small-extensions\/[^']+\.ts)'/g)) {
  if (!existsSync(join(repoRoot, source))) errors.push(`installer lists ${source}, which does not exist`);
}

if (errors.length > 0) {
  console.error('small-extension install channel drift detected:');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('Update the EXTENSIONS list in scripts/install-small-extension.mjs.');
  process.exit(1);
}
console.log(`small-extension installer OK (${names.length} extensions): ${names.join(', ')}`);

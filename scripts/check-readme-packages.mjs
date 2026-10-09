#!/usr/bin/env node
// README <-> packages consistency gate (BYTE-9, BYTE-3 drift root cause).
//
// Fails when:
//   1. a package under packages/ is missing from README's package table,
//   2. a package has no install line in README,
//   3. README references an @bytetrue package that does not exist under packages/.
//
// Runs in CI (ci.yml) and locally: node scripts/check-readme-packages.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');

const names = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages', entry.name, 'package.json'), 'utf8'));
    if (typeof pkg.name !== 'string') throw new Error(`packages/${entry.name}/package.json has no name`);
    return pkg.name;
  })
  .sort();

const errors = [];
const tableRows = readme.split('\n').filter((line) => line.trimStart().startsWith('|'));

for (const name of names) {
  if (!tableRows.some((row) => row.includes(name))) {
    errors.push(`README package table is missing ${name}`);
  }
  if (!readme.includes(`pi install npm:${name}`)) {
    errors.push(`README install section has no 'pi install npm:${name}' line`);
  }
}

const referenced = new Set([...readme.matchAll(/@bytetrue\/[\w-]+/g)].map((m) => m[0]));
for (const ref of referenced) {
  if (!names.includes(ref)) {
    errors.push(`README references ${ref}, which does not exist under packages/`);
  }
}

if (errors.length > 0) {
  console.error('README <-> packages drift detected:');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('Update README.md (package table + install list) to match packages/.');
  process.exit(1);
}
console.log(`README <-> packages consistency OK (${names.length} packages): ${names.join(', ')}`);

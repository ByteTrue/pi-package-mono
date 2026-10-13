#!/usr/bin/env node
// Install the small extensions of this repo (pi-package-mono) into the local Pi
// extensions directory (~/.pi/agent/extensions/).
//
//   node install-small-extension.mjs          arrow-key picker (needs a terminal)
//   node install-small-extension.mjs --all    install every extension, no prompt
//
// Idempotent: re-running overwrites in place - that IS the update path. No cache
// and no ref pinning: the files always come from the repo's main branch on GitHub raw.
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { emitKeypressEvents } from 'node:readline';

const REPO_RAW = 'https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main';
const EXTENSIONS_DIR = join(homedir(), '.pi', 'agent', 'extensions');

// One entry per installable extension: the repo-relative source file (its base name
// is the file name it keeps under EXTENSIONS_DIR) and the label shown in the picker.
// Adding an extension is one line here; scripts/check-small-extension-installer.mjs fails
// when a small-extensions/ directory never made it into this list.
const EXTENSIONS = [
  { source: 'small-extensions/pi-bash-timeout/pi-bash-timeout.ts', summary: '300s default + cap for the built-in bash / powershell tools' },
  { source: 'small-extensions/pi-ask-user/pi-ask-user.ts', summary: 'minimal ask_user tool: one decision question with typed options' },
  { source: 'small-extensions/pi-context-guard/pi-context-guard.ts', summary: 'compact at 400k on large-window models, session file in the prompt' },
  { source: 'small-extensions/pi-codemode-only/pi-codemode-only.ts', summary: 'enforce codemode.mode "only": block direct tool calls' },
];

const ERASE_LINE = '\x1b[2K';

function usage(stream) {
  stream.write('usage: install-small-extension.mjs [--all]\n');
  stream.write('  no arguments  pick extensions from an arrow-key menu (needs a terminal)\n');
  stream.write('  --all         install every small extension without prompting\n');
}

// Arrow-key multi-select. Resolves with the chosen entries, or null when cancelled
// (esc / ctrl-c). Everything is selected up front, so plain <enter> means "install all"
// and space is how you drop the ones you do not want.
function pick(items) {
  let index = 0;
  const selected = items.map(() => true);
  let drawn = 0;

  const frame = () => {
    // Truncate to the terminal width so a line never wraps: the redraw counts lines.
    // Unknown width (0/undefined, e.g. a pty with no size) disables truncation.
    const width = process.stdout.columns > 0 ? process.stdout.columns - 1 : Infinity;
    return [
      'Select the small extensions to install:',
      ...items.map((item, i) => `${i === index ? '❯' : ' '} ${selected[i] ? '◉' : '○'} ${basename(item.source, '.ts')}  ${item.summary}`),
      '↑/↓ move · space toggle · a all · enter install · esc cancel',
    ].map((line) => (line.length > width ? `${line.slice(0, width - 1)}…` : line));
  };

  const draw = (lines) => {
    let out = drawn > 0 ? `\x1b[${drawn}A` : '';
    for (const line of lines) out += `${ERASE_LINE}${line}\n`;
    drawn = lines.length;
    process.stdout.write(out);
  };

  return new Promise((resolve) => {
    const done = (result) => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write(`\x1b[${drawn}A\x1b[0J\x1b[?25h`);
      resolve(result);
    };

    const onKey = (_str, key) => {
      if (key.ctrl && key.name === 'c') return done(null);
      switch (key.name) {
        case 'up':
        case 'k':
          index = (index - 1 + items.length) % items.length;
          break;
        case 'down':
        case 'j':
          index = (index + 1) % items.length;
          break;
        case 'space':
          selected[index] = !selected[index];
          break;
        case 'a':
          selected.fill(!selected.every(Boolean));
          break;
        case 'return':
        case 'enter':
          return done(items.filter((_item, i) => selected[i]));
        case 'escape':
          return done(null);
        default:
          return;
      }
      draw(frame());
    };

    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKey);
    process.stdout.write('\x1b[?25l');
    draw(frame());
  });
}

async function install(entry) {
  const dest = join(EXTENSIONS_DIR, basename(entry.source));
  const tmp = `${dest}.tmp`;
  try {
    const res = await fetch(`${REPO_RAW}/${entry.source}`);
    if (!res.ok) throw new Error(`GET ${REPO_RAW}/${entry.source} failed with HTTP ${res.status}`);
    // Write beside the destination and rename: a half-written download never becomes
    // a loadable extension (mv is the atomic last step, same as the old scripts).
    await fs.writeFile(tmp, await res.text());
    await fs.rename(tmp, dest);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  console.log(`Installed ${basename(entry.source)} → ${dest}`);
}

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== '--all');
if (unknown.length > 0) {
  usage(process.stderr);
  process.exit(64);
}

let chosen = EXTENSIONS;
if (!args.includes('--all')) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('error: the picker needs a terminal, but stdin/stdout is not one.\n');
    process.stderr.write('  Save the script to a file and run it from your shell:\n');
    process.stderr.write('    curl -fsSL ' + REPO_RAW + '/scripts/install-small-extension.mjs -o /tmp/install-small-extension.mjs && node /tmp/install-small-extension.mjs\n');
    process.stderr.write('  Or install everything non-interactively: node install-small-extension.mjs --all\n');
    process.exit(64);
  }
  chosen = await pick(EXTENSIONS);
  if (chosen === null) {
    console.log('Cancelled — nothing installed.');
    process.exit(130);
  }
  if (chosen.length === 0) {
    console.log('Nothing selected — nothing installed.');
    process.exit(0);
  }
}

try {
  await fs.mkdir(EXTENSIONS_DIR, { recursive: true });
  for (const entry of chosen) await install(entry);
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

console.log('Done. Restart or reload Pi to load the extension(s).');

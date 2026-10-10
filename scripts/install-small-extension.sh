#!/usr/bin/env bash
# Install the small extensions of this repo (pi-package-mono) into the local Pi
# extensions directory.
#
# Zero arguments, idempotent (re-running overwrites in place — that IS the update
# path), exits non-zero on any failure. No flags: no cache, no ref pinning — the
# file always comes from the repo's main branch on GitHub raw.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main"
EXTENSIONS_DIR="${HOME}/.pi/agent/extensions"

# One line per extension file to install, repo-relative. Update = re-run.
EXTENSION_FILES=(
  "small-extensions/pi-bash-timeout/pi-bash-timeout.ts"
)

if [ "$#" -ne 0 ]; then
  echo "usage: install-small-extension.sh (takes no arguments)" >&2
  exit 64
fi

command -v curl >/dev/null 2>&1 || { echo "error: curl is required" >&2; exit 1; }
mkdir -p "${EXTENSIONS_DIR}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

for file in "${EXTENSION_FILES[@]}"; do
  name="$(basename "$file")"
  echo "Downloading ${REPO_RAW}/${file}"
  curl -fsSL "${REPO_RAW}/${file}" -o "$tmp"
  mv "$tmp" "${EXTENSIONS_DIR}/${name}"
  echo "Installed: ${EXTENSIONS_DIR}/${name}"
done

echo "Done. Restart or reload Pi to load the extension(s)."

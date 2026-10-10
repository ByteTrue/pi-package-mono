# Install the small extensions of this repo (pi-package-mono) into the local Pi
# extensions directory.
#
# Zero arguments, idempotent (re-running overwrites in place - that IS the update
# path), exits non-zero on any failure. No flags: no cache, no ref pinning - the
# file always comes from the repo's main branch on GitHub raw.
$ErrorActionPreference = "Stop"

$RepoRaw = "https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main"
$ExtensionsDir = Join-Path $HOME ".pi/agent/extensions"

# One line per extension file to install, repo-relative. Update = re-run.
$ExtensionFiles = @(
  "small-extensions/pi-bash-timeout/pi-bash-timeout.ts"
)

if ($args.Count -ne 0) {
  [Console]::Error.WriteLine("usage: install-small-extension.ps1 (takes no arguments)")
  exit 64
}

New-Item -ItemType Directory -Force -Path $ExtensionsDir | Out-Null

foreach ($file in $ExtensionFiles) {
  $name = Split-Path $file -Leaf
  Write-Host "Downloading $RepoRaw/$file"
  Invoke-WebRequest -Uri "$RepoRaw/$file" -OutFile "$ExtensionsDir/$name.tmp" -UseBasicParsing
  Move-Item -Force -Path "$ExtensionsDir/$name.tmp" -Destination "$ExtensionsDir/$name"
  Write-Host "Installed: $ExtensionsDir/$name"
}

Write-Host "Done. Restart or reload Pi to load the extension(s)."

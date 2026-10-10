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
  $tmp = "$ExtensionsDir/$name.tmp"
  try {
    Write-Host "Downloading $RepoRaw/$file"
    Invoke-WebRequest -Uri "$RepoRaw/$file" -OutFile $tmp -UseBasicParsing
    Move-Item -Force -Path $tmp -Destination "$ExtensionsDir/$name"
    Write-Host "Installed: $ExtensionsDir/$name"
  } finally {
    # The rename is the atomic last step; if the download succeeded but Move-Item
    # failed, the .tmp sidecar must not linger (the bash script gets this from its trap).
    if (Test-Path $tmp) { Remove-Item -Force $tmp }
  }
}

Write-Host "Done. Restart or reload Pi to load the extension(s)."

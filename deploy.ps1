# deploy.ps1
# Copies the Watchful extension files to <repo-parent>\Deploy\watchful
# Load that folder as an unpacked extension in Chrome (chrome://extensions).

$repoRoot  = $PSScriptRoot
$deployDir = Join-Path (Split-Path $repoRoot -Parent) "Deploy\watchful"

Write-Host "Deploying Watchful to: $deployDir"
Write-Host ""

# Clean slate
if (Test-Path $deployDir) { Remove-Item $deployDir -Recurse -Force }
New-Item -ItemType Directory -Path $deployDir -Force | Out-Null

# Extension source files (everything Chrome needs, nothing it doesn't)
$files = @(
    "manifest.json",
    "categories.js",
    "content.js",  "content.css",
    "feed.js",     "feed.html",  "feed.css",
    "watch.js",    "watch.css",
    "popup.js",    "popup.html",
    "player.js",   "player.html"
)

foreach ($f in $files) {
    $src = Join-Path $repoRoot $f
    if (Test-Path $src) {
        Copy-Item $src $deployDir
        Write-Host "  + $f"
    } else {
        Write-Warning "  ! not found: $f"
    }
}

# Icons folder
$iconsDir = Join-Path $repoRoot "icons"
if (Test-Path $iconsDir) {
    Copy-Item $iconsDir $deployDir -Recurse
    Write-Host "  + icons\"
}

Write-Host ""
Write-Host "Done. In Chrome: go to chrome://extensions, enable Developer mode,"
Write-Host "then click 'Load unpacked' and select:"
Write-Host "  $deployDir"

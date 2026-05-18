# deploy.ps1
# Copies the Watchful extension to <repo-parent>\Deploy\watchful, excluding
# dev-only files. Any new source files added to the repo are included automatically.
# Load the deploy folder as an unpacked extension in Chrome (chrome://extensions).

$repoRoot  = $PSScriptRoot
$deployDir = Join-Path (Split-Path $repoRoot -Parent) "Deploy\watchful"

Write-Host "Deploying Watchful to: $deployDir"
Write-Host ""

# Clean slate
if (Test-Path $deployDir) { Remove-Item $deployDir -Recurse -Force }
New-Item -ItemType Directory -Path $deployDir -Force | Out-Null

# robocopy exit codes 0-7 are success (0=nothing to do, 1=files copied, etc.)
robocopy $repoRoot $deployDir /S `
    /XD ".git" ".claude" "node_modules" `
    /XF "deploy.ps1" "package.json" "package-lock.json" "*.test.js" "README.md" ".gitignore" | Out-Null

if ($LASTEXITCODE -ge 8) {
    Write-Error "robocopy failed (exit code $LASTEXITCODE)"
    exit 1
}

Write-Host "Copied files:"
Get-ChildItem -Recurse $deployDir | Where-Object { -not $_.PSIsContainer } |
    ForEach-Object { Write-Host "  + $($_.FullName.Substring($deployDir.Length + 1))" }

Write-Host ""
Write-Host "Done. In Chrome: go to chrome://extensions, enable Developer mode,"
Write-Host "then click 'Load unpacked' and select:"
Write-Host "  $deployDir"

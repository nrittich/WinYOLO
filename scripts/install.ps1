$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  throw 'Bun 1.3 or newer is required. Install Bun for Windows, reopen PowerShell, and rerun this script.'
}

Push-Location $ProjectRoot
try {
  bun install --frozen-lockfile
  if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Host 'Created .env. Add OPENAI_API_KEY before using the API provider.' -ForegroundColor Yellow
  }
  bun run typecheck
  bun test
  bun run validate:plugin
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'WinYOLO is installed locally.' -ForegroundColor Green
Write-Host "Start:  $ProjectRoot\winyolo.cmd serve"
Write-Host "Check:  $ProjectRoot\winyolo.cmd doctor"
Write-Host 'Open:   http://127.0.0.1:4747'

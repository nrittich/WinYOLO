$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = 14747
$DataDir = Join-Path $env:TEMP 'winyolo-smoke-data'
$ServerOut = Join-Path $env:TEMP 'winyolo-smoke-server.out.log'
$ServerErr = Join-Path $env:TEMP 'winyolo-smoke-server.err.log'

if ($env:OS -ne 'Windows_NT') { throw 'This smoke test must run on native Windows.' }
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'Bun is not on PATH.' }
if (-not (Get-Command powershell.exe -ErrorAction SilentlyContinue)) { throw 'Windows PowerShell is unavailable.' }

Push-Location $ProjectRoot
try {
  bun install --frozen-lockfile
  bun run typecheck
  bun test
  bun run validate:plugin

  $env:WINYOLO_PORT = "$Port"
  $env:WINYOLO_DATA_DIR = $DataDir
  $env:WINYOLO_COMMAND_TIMEOUT_MS = '2000'
  $env:WINYOLO_MAX_OUTPUT_BYTES = '256'
  $Server = Start-Process bun -ArgumentList @('run','src/cli.ts','serve') -WorkingDirectory $ProjectRoot -PassThru -RedirectStandardOutput $ServerOut -RedirectStandardError $ServerErr
  try {
    $Healthy = $false
    foreach ($Attempt in 1..30) {
      Start-Sleep -Milliseconds 250
      try {
        $Health = Invoke-RestMethod "http://127.0.0.1:$Port/health"
        if ($Health.status -eq 'ok') { $Healthy = $true; break }
      } catch {}
    }
    if (-not $Healthy) { throw "Server did not become healthy. $((Get-Content $ServerErr -Raw -ErrorAction SilentlyContinue))" }
    if ($Health.platform -ne 'win32') { throw "Expected win32 health platform, got $($Health.platform)." }

    function Invoke-WinYoloTool($Name, $Arguments) {
      $Body = @{ name = $Name; arguments = $Arguments } | ConvertTo-Json -Depth 8
      Invoke-RestMethod "http://127.0.0.1:$Port/api/tools/execute" -Method Post -ContentType 'application/json' -Body $Body
    }

    $Inspection = Invoke-WinYoloTool 'win_system_inspect' @{ area = 'summary' }
    if (-not $Inspection.result.ok) { throw "Native Windows inspection failed: $($Inspection.result.error)" }

    $Output = Invoke-WinYoloTool 'win_shell' @{
      shell = 'powershell'
      script = "'x' * 4096"
      cwd = $null
      timeout_ms = 1000
      reason = 'Verify bounded output.'
    }
    if (-not $Output.result.truncated) { throw 'Large PowerShell output was not marked truncated.' }
    if ($Output.result.stdout.Length -gt 256) { throw 'Captured PowerShell output exceeded its byte cap.' }

    $Timeout = Invoke-WinYoloTool 'win_shell' @{
      shell = 'powershell'
      script = 'Start-Sleep -Seconds 5'
      cwd = $null
      timeout_ms = 250
      reason = 'Verify command timeout.'
    }
    if (-not $Timeout.result.timedOut) { throw 'Slow PowerShell command did not return a timeout result.' }

    $Demo = bun run src/cli.ts demo 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Demo failed: $Demo" }
    if ($Demo -notmatch 'awaiting|confirm') { throw 'Demo did not surface the protected-root confirmation fixture.' }

    $OriginBlocked = $false
    try {
      Invoke-WebRequest "http://127.0.0.1:$Port/api/runs" -Headers @{Origin='https://evil.example'} -UseBasicParsing | Out-Null
    } catch { $OriginBlocked = $_.Exception.Response.StatusCode.value__ -eq 403 }
    if (-not $OriginBlocked) { throw 'Unexpected browser Origin was not blocked.' }
  } finally {
    if ($Server -and -not $Server.HasExited) { Stop-Process -Id $Server.Id -Force }
  }
} finally {
  Pop-Location
}

Write-Host 'WINYOLO_WINDOWS_SMOKE_OK' -ForegroundColor Green

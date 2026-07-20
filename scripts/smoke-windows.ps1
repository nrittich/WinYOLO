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

    function Invoke-WinYoloMcp($Id, $Name, $Arguments) {
      $McpBody = @{
        jsonrpc = '2.0'
        id = $Id
        method = 'tools/call'
        params = @{ name = $Name; arguments = $Arguments }
      } | ConvertTo-Json -Depth 10
      (Invoke-WebRequest "http://127.0.0.1:$Port/mcp" -Method Post -ContentType 'application/json' -Headers @{Accept='application/json, text/event-stream'} -Body $McpBody -UseBasicParsing).Content
    }

    $Fixture = Join-Path $env:TEMP 'winyolo-mcp-confirm-fixture.txt'
    Set-Content -LiteralPath $Fixture -Value 'delete only after exact MCP confirmation'
    $McpArguments = @{
      shell = 'powershell'
      script = "Invoke-Expression `"Remove-Item '$Fixture' -Force`""
      cwd = $null
      timeout_ms = 1000
      reason = 'Verify dashboard-visible MCP confirmation and bound-call resumption.'
    }
    $McpBody = @{
      jsonrpc = '2.0'
      id = 100
      method = 'tools/call'
      params = @{ name = 'win_shell'; arguments = $McpArguments }
    } | ConvertTo-Json -Depth 10
    $McpJob = Start-Job -ArgumentList "http://127.0.0.1:$Port/mcp", $McpBody -ScriptBlock {
      param($Url, $Body)
      (Invoke-WebRequest $Url -Method Post -ContentType 'application/json' -Headers @{Accept='application/json, text/event-stream'} -Body $Body -UseBasicParsing).Content
    }
    try {
      $Pending = $null
      foreach ($Attempt in 1..100) {
        Start-Sleep -Milliseconds 50
        $Runs = Invoke-RestMethod "http://127.0.0.1:$Port/api/runs"
        $Pending = @($Runs.runs | Where-Object status -eq 'awaiting_confirmation') | Select-Object -First 1
        if ($Pending) { break }
      }
      if (-not $Pending) { throw 'MCP action did not create dashboard-visible pending approval.' }
      if (-not (Test-Path -LiteralPath $Fixture)) { throw 'MCP action executed before confirmation.' }

      $Approval = $Pending.pendingApproval
      $Wrong = Invoke-WinYoloMcp 101 'win_confirm' @{
        run_id = $Pending.id
        approval_id = $Approval.id
        decision = 'approve'
        confirmation = 'CONFIRM WRONG'
      }
      if ($Wrong -notmatch 'approval_mismatch') { throw 'Incorrect MCP confirmation was not rejected.' }
      if (-not (Test-Path -LiteralPath $Fixture)) { throw 'Wrong MCP confirmation released the action.' }

      $Exact = Invoke-WinYoloMcp 102 'win_confirm' @{
        run_id = $Pending.id
        approval_id = $Approval.id
        decision = 'approve'
        confirmation = $Approval.assessment.confirmationPhrase
      }
      if ($Exact -notmatch '\"ok\":true') { throw 'Exact MCP confirmation was not accepted.' }
      Wait-Job $McpJob -Timeout 10 | Out-Null
      if ($McpJob.State -ne 'Completed') { throw 'Confirmed MCP action did not complete.' }
      $McpResult = Receive-Job $McpJob | Out-String
      if ($McpResult -notmatch '\"ok\":true') { throw "Confirmed MCP action failed: $McpResult" }
      if (Test-Path -LiteralPath $Fixture) { throw 'Confirmed MCP action did not execute its bound call.' }

      $Completed = (Invoke-RestMethod "http://127.0.0.1:$Port/api/runs/$($Pending.id)").run
      if ($Completed.status -ne 'completed') { throw "Confirmed MCP run ended as $($Completed.status)." }
      $EventTypes = @($Completed.events | ForEach-Object type)
      foreach ($Expected in @('approval.required','approval.accepted','tool.completed','run.completed')) {
        if ($EventTypes -notcontains $Expected) { throw "MCP receipt is missing $Expected." }
      }
    } finally {
      Remove-Job $McpJob -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $Fixture -Force -ErrorAction SilentlyContinue
    }

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

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = 14747
$DataDir = Join-Path $env:TEMP 'winyolo-smoke-data'
$ServerOut = Join-Path $env:TEMP 'winyolo-smoke-server.out.log'
$ServerErr = Join-Path $env:TEMP 'winyolo-smoke-server.err.log'

if ($env:OS -ne 'Windows_NT') { throw 'This smoke test must run on native Windows.' }
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'Bun is not on PATH.' }
if (-not (Get-Command powershell.exe -ErrorAction SilentlyContinue)) { throw 'Windows PowerShell is unavailable.' }
$GitCandidates = @('C:\Program Files\Git\cmd', 'C:\Program Files\Git\bin') | Where-Object { Test-Path $_ }
if ($GitCandidates) { $env:Path = (($GitCandidates -join ';') + ';' + $env:Path) }
 $AppleDouble = @(Get-ChildItem $ProjectRoot -Recurse -Force -File -Filter '._*' -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath $_.FullName })
if ($AppleDouble) {
  throw 'Mac AppleDouble metadata files were deployed into the Windows project.'
}

Push-Location $ProjectRoot
try {
  bun install --frozen-lockfile
  bun run typecheck
  bun test
  bun run validate:plugin
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1

  $Launcher = Get-Command winyolo -ErrorAction Stop
  $ExpectedLauncher = Join-Path (Split-Path -Parent (Get-Command bun -ErrorAction Stop).Source) 'winyolo.cmd'
  if (-not $Launcher.Source.Equals($ExpectedLauncher, [StringComparison]::OrdinalIgnoreCase)) {
    throw "WinYOLO resolved to '$($Launcher.Source)' instead of '$ExpectedLauncher'."
  }
  $ShimText = Get-Content $Launcher.Source -Raw
  if ($ShimText -notmatch [regex]::Escape((Join-Path $ProjectRoot 'winyolo.cmd'))) {
    throw 'WinYOLO PATH shim does not target this project root.'
  }
  $CodexVersion = & winyolo --version 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $CodexVersion -notmatch 'codex-cli') { throw "Bare WinYOLO did not pass through to Codex: $CodexVersion" }
  $Doctor = & winyolo doctor 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $Doctor -notmatch 'WinYOLO doctor') { throw "Bare WinYOLO doctor failed: $Doctor" }
  & winyolo safe --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'WinYOLO Safe mode did not reach Codex.' }
  & winyolo yolo --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'WinYOLO constrained YOLO mode did not reach Codex.' }
  $PreviousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & winyolo --dangerously-bypass-approvals-and-sandbox 2>$null | Out-Null
  $BypassExitCode = $LASTEXITCODE
  $ErrorActionPreference = $PreviousErrorActionPreference
  if ($BypassExitCode -eq 0) { throw 'WinYOLO accepted an unrestricted bypass flag.' }
  $PluginList = codex plugin list --json | ConvertFrom-Json
  if (($PluginList | ConvertTo-Json -Depth 10) -notmatch 'winyolo') { throw 'WinYOLO plugin is not installed.' }

  $env:WINYOLO_PORT = "$Port"
  $env:WINYOLO_DATA_DIR = $DataDir
  # CIM inventory can take several seconds on a cold Windows host. Keep the
  # harness ceiling generous; the dedicated timeout assertion below still
  # supplies its own 250 ms limit.
  $env:WINYOLO_COMMAND_TIMEOUT_MS = '15000'
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
    if (-not $Health.codex.available) { throw 'Health endpoint did not find native Codex.' }
    $Capabilities = Invoke-RestMethod "http://127.0.0.1:$Port/api/windows/capabilities"
    if (-not $Capabilities.ok -or -not $Capabilities.capabilities.native) { throw 'Windows capability endpoint did not report native readiness.' }
    $Threads = Invoke-RestMethod "http://127.0.0.1:$Port/api/codex/threads?limit=1&archived=false"
    if (-not $Threads.ok) { throw 'Codex thread gateway did not respond.' }

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

    function ConvertFrom-WinYoloMcp($Content) {
      $DataLine = @($Content -split "`r?`n" | Where-Object { $_ -like 'data: *' }) | Select-Object -Last 1
      if (-not $DataLine) { throw "MCP response did not contain an SSE data event: $Content" }
      $Envelope = $DataLine.Substring(6) | ConvertFrom-Json
      if ($Envelope.error) { throw "MCP JSON-RPC error: $($Envelope.error | ConvertTo-Json -Compress)" }
      $Envelope.result.content[0].text | ConvertFrom-Json
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
      $Wrong = ConvertFrom-WinYoloMcp (Invoke-WinYoloMcp 101 'win_confirm' @{
        run_id = $Pending.id
        approval_id = $Approval.id
        decision = 'approve'
        confirmation = 'CONFIRM WRONG'
      })
      if ($Wrong.ok -or $Wrong.error -ne 'approval_mismatch') { throw 'Incorrect MCP confirmation was not rejected.' }
      if (-not (Test-Path -LiteralPath $Fixture)) { throw 'Wrong MCP confirmation released the action.' }

      $Exact = ConvertFrom-WinYoloMcp (Invoke-WinYoloMcp 102 'win_confirm' @{
        run_id = $Pending.id
        approval_id = $Approval.id
        decision = 'approve'
        confirmation = $Approval.assessment.confirmationPhrase
      })
      if (-not $Exact.ok) { throw 'Exact MCP confirmation was not accepted.' }
      Wait-Job $McpJob -Timeout 10 | Out-Null
      if ($McpJob.State -ne 'Completed') { throw 'Confirmed MCP action did not complete.' }
      $McpResult = Receive-Job $McpJob | Out-String
      $Managed = ConvertFrom-WinYoloMcp $McpResult
      if (-not $Managed.result.ok) { throw "Confirmed MCP action failed: $McpResult" }
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

    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Demo = bun run src/cli.ts demo 2>&1 | Out-String
    $DemoExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorActionPreference
    if ($DemoExitCode -ne 0) { throw "Demo failed: $Demo" }
    if ($Demo -notmatch 'Initial failure captured') { throw 'Demo did not capture the deterministic failing test.' }

    $OriginBlocked = $false
    try {
      Invoke-WebRequest "http://127.0.0.1:$Port/api/runs" -Headers @{Origin='https://evil.example'} -UseBasicParsing | Out-Null
    } catch { $OriginBlocked = $_.Exception.Response.StatusCode.value__ -eq 403 }
    if (-not $OriginBlocked) { throw 'Unexpected browser Origin was not blocked.' }

    $RuntimeSources = Get-Content src\cli.ts,src\codex-launcher.ts,src\codex-gateway.ts,src\codex-http.ts -Raw
    bun run scripts/source-scan.ts
    if ($LASTEXITCODE -ne 0) { throw 'Production source scan found a forbidden compatibility transport.' }
  } finally {
    if ($Server -and -not $Server.HasExited) { Stop-Process -Id $Server.Id -Force }
  }
} finally {
  Pop-Location
}

Write-Host 'WINYOLO_WINDOWS_SMOKE_OK' -ForegroundColor Green

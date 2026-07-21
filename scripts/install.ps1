param(
  [switch]$Full,
  [switch]$ProvisionRunnerAuth,
  [switch]$Elevated,
  [string]$InstallUserSid,
  [string]$InstallUserName,
  [string]$UserLocalAppData,
  [string]$InstallUserProfile
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Test-Administrator {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$Identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($Full -and -not (Test-Administrator)) {
  $CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $InstallUserSid = $CurrentIdentity.User.Value
  $InstallUserName = $CurrentIdentity.Name
  $UserLocalAppData = $env:LOCALAPPDATA
  $InstallUserProfile = $env:USERPROFILE
  $Arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), '-Elevated', '-InstallUserSid', ('"{0}"' -f $InstallUserSid), '-InstallUserName', ('"{0}"' -f $InstallUserName), '-UserLocalAppData', ('"{0}"' -f $UserLocalAppData), '-InstallUserProfile', ('"{0}"' -f $InstallUserProfile))
  if ($Full) { $Arguments += '-Full' }
  if ($ProvisionRunnerAuth) { $Arguments += '-ProvisionRunnerAuth' }
  $Process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $Arguments -Wait -PassThru
  if ($Process.ExitCode -ne 0) { exit $Process.ExitCode }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  & $PSCommandPath
  exit $LASTEXITCODE
}

if (-not $InstallUserSid) { $InstallUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
if (-not $InstallUserName) { $InstallUserName = [Security.Principal.WindowsIdentity]::GetCurrent().Name }
if (-not $UserLocalAppData) { $UserLocalAppData = $env:LOCALAPPDATA }
if (-not $InstallUserProfile) { $InstallUserProfile = $env:USERPROFILE }

function Install-WinGetPackage([string]$Id, [Parameter(ValueFromRemainingArguments=$true)][string[]]$Extra = @()) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'WinGet is required for -Full installation.' }
  & winget.exe upgrade --id $Id --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity @Extra
  if ($LASTEXITCODE -ne 0) {
    & winget.exe list --id $Id --exact --accept-source-agreements --disable-interactivity | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    & winget.exe install --id $Id --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity @Extra
    if ($LASTEXITCODE -ne 0) { throw "WinGet installation failed for $Id with exit code $LASTEXITCODE." }
  }
}

if ($Full) {
  Install-WinGetPackage 'Oven-sh.Bun'
  Install-WinGetPackage 'Git.Git'
  Install-WinGetPackage 'Microsoft.DotNet.SDK.8'
  Install-WinGetPackage -Id 'Microsoft.VisualStudio.2022.BuildTools' -Extra @('--override', '--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.MSBuildTools --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
  Install-WinGetPackage 'Microsoft.WindowsSDK.10.0.26100'
  $MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $UserPathNow = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$MachinePath;$UserPathNow"
  if (-not (Get-Command bun.exe -ErrorAction SilentlyContinue) -and -not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'Bun was installed but is not visible on PATH.' }
  bun add --global @openai/codex
  if ($LASTEXITCODE -ne 0) { throw "Codex installation failed with exit code $LASTEXITCODE." }
  $OpenAIGlobal = Join-Path $env:USERPROFILE '.bun\install\global\node_modules\@openai'
  $InstalledCodex = Get-ChildItem -LiteralPath $OpenAIGlobal -Recurse -File -Filter 'codex.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '[\\/]vendor[\\/].*[\\/]bin[\\/]codex\.exe$' } |
    Sort-Object Length -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $InstalledCodex) { throw 'The standalone native Codex binary was not found in the installed @openai package.' }
  $SharedBin = Join-Path $env:ProgramData 'WinYOLO\bin'
  New-Item -ItemType Directory -Force -Path $SharedBin | Out-Null
  Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $InstalledCodex) '*.exe') -Destination $SharedBin -Force
  & icacls.exe (Join-Path $env:ProgramData 'WinYOLO') /inheritance:r /grant:r 'Users:(OI)(CI)RX' 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  throw 'Bun 1.3 or newer is required. Install Bun for Windows, reopen PowerShell, and rerun this script.'
}
$GitPath = @('C:\Program Files\Git\cmd', 'C:\Program Files\Git\bin') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($GitPath) {
  $ExistingUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($ExistingUserPath -split ';') | Where-Object { $_.TrimEnd('\\').Equals($GitPath.TrimEnd('\\'), [StringComparison]::OrdinalIgnoreCase) })) {
    [Environment]::SetEnvironmentVariable('Path', (($ExistingUserPath -split ';' | Where-Object { $_ }) + $GitPath) -join ';', 'User')
  }
  if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\\').Equals($GitPath.TrimEnd('\\'), [StringComparison]::OrdinalIgnoreCase) })) { $env:Path = "$GitPath;$env:Path" }
}
if (-not (Get-Command codex.exe -ErrorAction SilentlyContinue) -and -not (Get-Command codex -ErrorAction SilentlyContinue)) {
  throw 'The Windows-native Codex CLI is required. Install Codex, reopen PowerShell, and rerun this script.'
}

$DataRoot = Join-Path $UserLocalAppData 'WinYOLO'
$ProtectedRoot = Join-Path $DataRoot 'protected'
$WorkspaceRoot = Join-Path $DataRoot 'workspaces'
$RunnerProfile = Join-Path $DataRoot 'runner-profile'
$RunnerCodexHome = Join-Path $DataRoot 'runner-codex-home'
New-Item -ItemType Directory -Force -Path $ProtectedRoot, $WorkspaceRoot, $RunnerProfile, $RunnerCodexHome | Out-Null
$GuideSource = Join-Path $ProjectRoot 'WINDOWS-FULL-IMPLEMENTATION-STEPS.txt'
$GuideTarget = Join-Path ([Environment]::GetFolderPath('Desktop')) 'WINDOWS-FULL-IMPLEMENTATION-STEPS.txt'
Copy-Item -LiteralPath $GuideSource -Destination $GuideTarget -Force

if ($Full) {
  $RunnerName = 'WinYOLORunner'
  $PasswordBytes = New-Object byte[] 36
  $PasswordGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $PasswordGenerator.GetBytes($PasswordBytes) } finally { $PasswordGenerator.Dispose() }
  $RunnerPassword = [Convert]::ToBase64String($PasswordBytes) + '!aA9'
  $SecurePassword = ConvertTo-SecureString $RunnerPassword -AsPlainText -Force
  $ExistingRunner = Get-LocalUser -Name $RunnerName -ErrorAction SilentlyContinue
  if ($ExistingRunner) {
    Set-LocalUser -Name $RunnerName -Password $SecurePassword -PasswordNeverExpires $true -UserMayChangePassword $false
    Enable-LocalUser -Name $RunnerName
  } else {
    New-LocalUser -Name $RunnerName -Password $SecurePassword -AccountNeverExpires -PasswordNeverExpires -UserMayNotChangePassword -Description 'Restricted WinYOLO isolated job runner' | Out-Null
  }
  $CredentialPath = Join-Path $ProtectedRoot 'runner.dpapi'
  $PlainBytes = [Text.Encoding]::UTF8.GetBytes($RunnerPassword)
  try {
    Add-Type -AssemblyName System.Security
    $ProtectedBytes = [Security.Cryptography.ProtectedData]::Protect($PlainBytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    [IO.File]::WriteAllText($CredentialPath, [Convert]::ToBase64String($ProtectedBytes), [Text.Encoding]::ASCII)
  } finally {
    [Array]::Clear($PlainBytes, 0, $PlainBytes.Length)
    if ($ProtectedBytes) { [Array]::Clear($ProtectedBytes, 0, $ProtectedBytes.Length) }
  }
  $RunnerPassword = $null
  $SecurePassword.Dispose()
  # The runner needs to traverse the data root to reach only its explicitly
  # allowlisted workspace/profile children. The non-inherited RX grant does
  # not grant access to the protected credential directory.
  & icacls.exe $DataRoot /inheritance:r /grant:r "*$InstallUserSid`:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' "${RunnerName}:(RX)" | Out-Null
  & icacls.exe $WorkspaceRoot /grant:r "${RunnerName}:(OI)(CI)M" | Out-Null
  & icacls.exe $RunnerProfile /grant:r "${RunnerName}:(OI)(CI)M" | Out-Null
  & icacls.exe $ProtectedRoot /remove:g $RunnerName | Out-Null
  & icacls.exe $CredentialPath /inheritance:r /grant:r "*$InstallUserSid`:F" 'SYSTEM:F' | Out-Null
  $Profiles = @'
# Generated by WinYOLO 0.3
[profiles.winyolo-safe]
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[profiles.winyolo-yolo]
approval_policy = "never"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = false
'@
  [IO.File]::WriteAllText((Join-Path $DataRoot 'codex-profiles.toml'), $Profiles, [Text.UTF8Encoding]::new($false))
}

if ($ProvisionRunnerAuth) {
  $RunnerName = 'WinYOLORunner'
  if (-not (Get-LocalUser -Name $RunnerName -ErrorAction SilentlyContinue)) {
    throw 'WinYOLORunner is missing. Run the full installer once, then provision runner authentication.'
  }
  $SourceAuth = Join-Path (Join-Path $InstallUserProfile '.codex') 'auth.json'
  if (-not (Test-Path -LiteralPath $SourceAuth -PathType Leaf)) {
    throw 'The installing user has no file-backed Codex login. Run codex login as the installing user, then retry -ProvisionRunnerAuth.'
  }
  try {
    $AuthDocument = Get-Content -LiteralPath $SourceAuth -Raw | ConvertFrom-Json
  } catch {
    throw 'The installing user Codex auth.json is not valid JSON.'
  }
  $HasApiKey = [bool]$AuthDocument.OPENAI_API_KEY
  $HasTokenSet = [bool]($AuthDocument.tokens -and $AuthDocument.tokens.access_token -and $AuthDocument.tokens.refresh_token)
  if (-not ($HasApiKey -or $HasTokenSet)) {
    throw 'The installing user Codex auth.json does not contain a reusable API key or refreshable token set.'
  }
  $RunnerAuthPath = Join-Path $RunnerCodexHome 'auth.json'
  Copy-Item -LiteralPath $SourceAuth -Destination $RunnerAuthPath -Force
  $RunnerConfig = @'
cli_auth_credentials_store = "file"

[windows]
sandbox = "elevated"

[shell_environment_policy]
inherit = "core"
ignore_default_excludes = false
exclude = ["CODEX_ACCESS_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY", "*TOKEN*", "*KEY*", "*SECRET*"]
'@
  [IO.File]::WriteAllText((Join-Path $RunnerCodexHome 'config.toml'), $RunnerConfig, [Text.UTF8Encoding]::new($false))
  $PreviousCodexHome = $env:CODEX_HOME
  try {
    $env:CODEX_HOME = $RunnerCodexHome
    $RunnerPluginManifest = Join-Path $RunnerCodexHome 'plugins\cache\winyolo-local\winyolo\0.3.0\.codex-plugin\plugin.json'
    if (-not (Test-Path -LiteralPath $RunnerPluginManifest)) {
      codex plugin marketplace add $ProjectRoot --json | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Runner Codex marketplace registration failed.' }
      codex plugin add winyolo@winyolo-local --json | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Runner WinYOLO plugin installation failed.' }
    }
  } finally {
    $env:CODEX_HOME = $PreviousCodexHome
  }
  & icacls.exe $RunnerCodexHome /inheritance:r /grant:r "*$InstallUserSid`:(OI)(CI)F" "${RunnerName}:(OI)(CI)M" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the runner Codex home ACL.' }
  # Native Windows sandbox identities do not rely on bypass-traverse privilege.
  # Grant only directory traversal (not read/list) through the profile
  # ancestors needed to reach the isolated WinYOLO data root.
  foreach ($TraverseRoot in @($InstallUserProfile, (Join-Path $InstallUserProfile 'AppData'), $UserLocalAppData)) {
    & icacls.exe $TraverseRoot /grant:r "${RunnerName}:(X)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to grant runner traverse-only access to $TraverseRoot." }
  }
  if (-not (Get-LocalGroup -Name 'CodexSandboxUsers' -ErrorAction SilentlyContinue)) {
    throw 'CodexSandboxUsers is missing. Run Codex Windows sandbox setup, then retry runner authentication provisioning.'
  }
  & icacls.exe $DataRoot /grant:r 'CodexSandboxUsers:(RX)' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to grant the native Codex sandbox access to the WinYOLO data root.' }
  & icacls.exe $WorkspaceRoot /grant:r 'CodexSandboxUsers:(OI)(CI)M' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to grant the native Codex sandbox access to disposable workspaces.' }
  & icacls.exe $RunnerAuthPath /inheritance:r /grant:r "*$InstallUserSid`:F" "${RunnerName}:M" '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the runner Codex authentication ACL.' }
  $AuthDocument = $null
  Write-Host 'Runner Codex authentication was provisioned without displaying credentials.' -ForegroundColor Green
  if (-not $Full) { exit 0 }
}

Push-Location $ProjectRoot
try {
  bun install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "bun install failed with exit code $LASTEXITCODE." }
  if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Host 'Created .env. Add OPENAI_API_KEY before using the API provider.' -ForegroundColor Yellow
  }
  bun run typecheck
  if ($LASTEXITCODE -ne 0) { throw "TypeScript check failed with exit code $LASTEXITCODE." }
  bun test
  if ($LASTEXITCODE -ne 0) { throw "Test suite failed with exit code $LASTEXITCODE." }
  bun run validate:plugin
  if ($LASTEXITCODE -ne 0) { throw "Plugin validation failed with exit code $LASTEXITCODE." }
  codex --version
  if ($LASTEXITCODE -ne 0) { throw "Codex version check failed with exit code $LASTEXITCODE." }
  codex plugin marketplace add $ProjectRoot --json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Codex marketplace installation failed with exit code $LASTEXITCODE." }
  codex plugin add winyolo@winyolo-local --json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WinYOLO plugin installation failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$PathEntries = @($UserPath -split ';' | Where-Object { $_ })
$NormalizedRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
if (-not ($PathEntries | Where-Object { [IO.Path]::GetFullPath($_).TrimEnd('\').Equals($NormalizedRoot, [StringComparison]::OrdinalIgnoreCase) })) {
  $NewUserPath = (@($PathEntries) + $NormalizedRoot) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $NewUserPath, 'User')
}
if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\').Equals($NormalizedRoot, [StringComparison]::OrdinalIgnoreCase) })) {
  $env:Path = "$env:Path;$NormalizedRoot"
}

# The installer cannot mutate its parent PowerShell process. Put a tiny shim in
# Bun's already-active PATH directory so `winyolo` resolves immediately as well
# as in future shells, while keeping the project-root PATH entry for direct use.
$BunBin = Split-Path -Parent (Get-Command bun -ErrorAction Stop).Source
$ShimPath = Join-Path $BunBin 'winyolo.cmd'
$ShimContent = "@echo off`r`ncall `"$ProjectRoot\winyolo.cmd`" %*`r`nexit /b %ERRORLEVEL%`r`n"
[IO.File]::WriteAllText($ShimPath, $ShimContent, [Text.Encoding]::ASCII)

Write-Host ''
Write-Host 'WinYOLO is installed for this user.' -ForegroundColor Green
Write-Host "Launcher: $ShimPath"
Write-Host 'Start:  winyolo'
Write-Host 'Safe:   winyolo (or winyolo safe)'
Write-Host 'YOLO:   winyolo yolo'
Write-Host 'Isolate: winyolo isolated "task"'
Write-Host "Serve:  $ProjectRoot\winyolo.cmd serve"
Write-Host "Check:  $ProjectRoot\winyolo.cmd doctor"
Write-Host 'Open:   http://127.0.0.1:4747'

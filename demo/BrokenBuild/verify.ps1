$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSCommandPath
dotnet test (Join-Path $Root 'BrokenBuild.sln') --nologo
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'BROKEN_BUILD_TESTS_PASS'

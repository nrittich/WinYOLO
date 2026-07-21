$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSCommandPath
Copy-Item -LiteralPath (Join-Path $Root 'fixtures\Calculator.broken.cs') -Destination (Join-Path $Root 'src\BrokenBuild\Calculator.cs') -Force
Remove-Item -LiteralPath (Join-Path $Root 'src\BrokenBuild\bin'), (Join-Path $Root 'src\BrokenBuild\obj'), (Join-Path $Root 'tests\BrokenBuild.Tests\bin'), (Join-Path $Root 'tests\BrokenBuild.Tests\obj') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'BROKEN_BUILD_RESET'

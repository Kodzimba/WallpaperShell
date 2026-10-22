$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$verificationDir = Join-Path $projectRoot 'verification'
New-Item -ItemType Directory -Force -Path $verificationDir | Out-Null
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$output = Join-Path $verificationDir 'LauncherSessionTests.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$output" (Join-Path $projectRoot 'runtime\companion\LauncherSession.cs') (Join-Path $projectRoot 'runtime\companion\LauncherPlacement.cs') (Join-Path $projectRoot 'tests\LauncherSessionTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher session test compilation failed.' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Launcher session tests failed.' }

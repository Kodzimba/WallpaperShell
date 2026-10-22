param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$wsRoot=Split-Path -Parent $PSScriptRoot
if(!(Test-Path -LiteralPath (Join-Path $wsRoot 'bin\node.exe'))){& (Join-Path $PSScriptRoot 'bootstrap-build.ps1') -SkipBuild}
& (Join-Path $PSScriptRoot 'assert-dependencies.ps1')
if(!$?){throw 'Source export dependency integrity check failed.'}
& (Join-Path $wsRoot 'bin\node.exe') (Join-Path $PSScriptRoot 'publication.cjs') export $Destination
if($LASTEXITCODE -ne 0){throw 'Allowlist source export failed.'}

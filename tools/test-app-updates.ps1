$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
$pgOutput=Join-Path $pgRoot 'verification\AppUpdatesTests.exe'
$pgCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $pgCompiler /nologo /target:exe /platform:x64 /optimize+ ('/out:'+$pgOutput) /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $pgRoot 'src\AppUpdates.cs') (Join-Path $pgRoot 'tests\AppUpdatesTests.cs')
if($LASTEXITCODE -ne 0){throw 'App update tests compilation failed.'}
& $pgOutput
if($LASTEXITCODE -ne 0){throw 'App update tests failed.'}

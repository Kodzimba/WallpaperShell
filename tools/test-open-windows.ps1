$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
$pgCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$pgOutput=Join-Path $pgRoot 'verification\OpenWindowsTests.exe'
[void](New-Item -ItemType Directory -Path (Join-Path $pgRoot 'verification') -Force)
& $pgCompiler /nologo /target:exe /platform:x64 /optimize+ ('/out:'+$pgOutput) /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll (Join-Path $pgRoot 'src\OpenWindows.cs') (Join-Path $pgRoot 'tests\OpenWindowsTests.cs')
if($LASTEXITCODE -ne 0){throw 'Open windows test compilation failed.'}
& $pgOutput
if($LASTEXITCODE -ne 0){throw 'Open windows pure rule tests failed.'}

$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
$pgCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$pgOutput=Join-Path $pgRoot 'verification\WindowPolicyTests.exe'
& $pgCompiler /nologo /target:exe /platform:x64 /optimize+ ('/out:'+$pgOutput) /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll (Join-Path $pgRoot 'src\WindowPolicy.cs') (Join-Path $pgRoot 'src\WindowAttention.cs') (Join-Path $pgRoot 'src\DesktopHubPolicy.cs') (Join-Path $pgRoot 'tests\WindowPolicyTests.cs')
if($LASTEXITCODE -ne 0){throw 'Window policy test compilation failed.'}
& $pgOutput
if($LASTEXITCODE -ne 0){throw 'Native window policy tests failed.'}

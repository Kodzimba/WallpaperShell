$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
$pgCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$pgOutput=Join-Path $pgRoot 'verification\LayoutFilesTests.exe'
& $pgCompiler /nologo /target:exe /platform:x64 /optimize+ ('/out:'+$pgOutput) /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll (Join-Path $pgRoot 'src\LayoutFiles.cs') (Join-Path $pgRoot 'tests\LayoutFilesTests.cs')
if($LASTEXITCODE -ne 0){throw 'Layout file test compilation failed.'}
& $pgOutput
if($LASTEXITCODE -ne 0){throw 'Native layout file tests failed.'}

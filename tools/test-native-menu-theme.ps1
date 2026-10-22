$ErrorActionPreference='Stop'
$pgMenuRoot=Split-Path -Parent $PSScriptRoot
$pgMenuCompiler=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$pgMenuTest=Join-Path $pgMenuRoot 'verification/NativeMenuThemeTests.exe'
& $pgMenuCompiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$pgMenuTest" (Join-Path $pgMenuRoot 'runtime/companion/LauncherMenuTheme.cs') (Join-Path $pgMenuRoot 'tests/NativeMenuThemeTests.cs')
if($LASTEXITCODE -ne 0){throw 'Native menu theme compilation failed.'}
& $pgMenuTest --test
if($LASTEXITCODE -ne 0){throw 'Native menu theme tests failed.'}

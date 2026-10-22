$ErrorActionPreference='Stop'
$themeRoot=Split-Path -Parent $PSScriptRoot
$themeCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $themeCompiler /nologo /target:exe /platform:x64 ('/out:'+(Join-Path $themeRoot 'verification\ThemeSupportTests.exe')) (Join-Path $themeRoot 'src\ThemeSupport.cs') (Join-Path $themeRoot 'tests\ThemeSupportTests.cs')
if($LASTEXITCODE -ne 0){throw 'Theme test compilation failed.'}
& (Join-Path $themeRoot 'verification\ThemeSupportTests.exe')
if($LASTEXITCODE -ne 0){throw 'Theme tests failed.'}

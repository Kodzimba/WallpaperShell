$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
$pgOutput=Join-Path $pgRoot 'verification\WebViewRecoveryTests.exe'
$pgCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $pgCompiler /nologo /target:exe /platform:x64 /optimize+ ('/out:'+$pgOutput) (Join-Path $pgRoot 'src\WebViewRecovery.cs') (Join-Path $pgRoot 'tests\WebViewRecoveryTests.cs')
if($LASTEXITCODE -ne 0){throw 'WebView recovery test compilation failed.'}
& $pgOutput
if($LASTEXITCODE -ne 0){throw 'WebView recovery pure tests failed.'}

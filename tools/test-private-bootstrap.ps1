$ErrorActionPreference='Stop'
$auditRoot=Split-Path -Parent $PSScriptRoot
$auditOutput=Join-Path $auditRoot 'verification\private-bootstrap-audit'
[void](New-Item -ItemType Directory -Path $auditOutput -Force)
$auditCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $auditCompiler /nologo /target:exe /platform:x64 /optimize+ ('/out:'+(Join-Path $auditOutput 'PrivateBootstrapTests.exe')) /reference:System.dll /reference:System.Core.dll (Join-Path $auditRoot 'runtime\companion\PrivateBootstrap.cs') (Join-Path $auditRoot 'tests\PrivateBootstrapTests.cs')
if($LASTEXITCODE -ne 0){throw 'Private bootstrap test compilation failed.'}
& (Join-Path $auditOutput 'PrivateBootstrapTests.exe')
if($LASTEXITCODE -ne 0){throw 'Private bootstrap ACL tests failed.'}
& (Join-Path $auditRoot 'bin\node.exe') (Join-Path $auditRoot 'tests\private-bootstrap-script.cjs') $auditOutput
if($LASTEXITCODE -ne 0){throw 'Private bootstrap script isolation tests failed.'}

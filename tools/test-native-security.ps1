$ErrorActionPreference='Stop'
$auditRoot=Split-Path -Parent $PSScriptRoot
$auditOutput=Join-Path $auditRoot 'verification\native-security-audit'
[void](New-Item -ItemType Directory -Path $auditOutput -Force)
$auditCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $auditCompiler /nologo /target:exe /platform:x64 /optimize+ ('/out:'+(Join-Path $auditOutput 'NativeSecurityTests.exe')) /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $auditRoot 'src\NativeDiagnostics.cs') (Join-Path $auditRoot 'src\AppUpdates.cs') (Join-Path $auditRoot 'src\LayoutFiles.cs') (Join-Path $auditRoot 'runtime\companion\PrivateBootstrap.cs') (Join-Path $auditRoot 'tests\NativeSecurityTests.cs')
if($LASTEXITCODE -ne 0){throw 'Native security test compilation failed.'}
& (Join-Path $auditOutput 'NativeSecurityTests.exe')
if($LASTEXITCODE -ne 0){throw 'Native security tests failed.'}

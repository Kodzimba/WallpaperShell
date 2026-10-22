$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
Push-Location $pgRoot
try{
 [void](New-Item -ItemType Directory -Path 'verification' -Force)
 & bin\node.exe --test --test-concurrency=1 tests/*.test.cjs
 if($LASTEXITCODE -ne 0){throw 'JavaScript tests failed.'}
 & "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /platform:x64 /optimize+ /out:verification\AudioTests.exe src\AudioLoopback.cs tests\AudioTests.cs
 if($LASTEXITCODE -ne 0){throw 'Audio test compilation failed.'}
 & verification\AudioTests.exe
 if($LASTEXITCODE -ne 0){throw 'Native audio tests failed.'}
 & (Join-Path $PSScriptRoot 'test-webview-recovery.ps1')
 if(!$?){throw 'WebView recovery tests failed.'}
 & (Join-Path $PSScriptRoot 'test-worker-interop.ps1')
 if(!$?){throw 'Worker interop load/fallback tests failed.'}
 & (Join-Path $PSScriptRoot 'test-layout-files.ps1')
 if(!$?){throw 'Native layout file tests failed.'}
 & (Join-Path $PSScriptRoot 'test-window-policy.ps1')
 if(!$?){throw 'Native window policy tests failed.'}
 & (Join-Path $PSScriptRoot 'test-launcher-session.ps1')
 if(!$?){throw 'Native launcher session tests failed.'}
 & (Join-Path $PSScriptRoot 'test-native-menu-theme.ps1')
 if(!$?){throw 'Native menu theme tests failed.'}
 & (Join-Path $PSScriptRoot 'test-open-windows.ps1')
 if(!$?){throw 'Native open-window tests failed.'}
 & (Join-Path $PSScriptRoot 'test-notifications.ps1')
 if(!$?){throw 'Native notification tests failed.'}
 & (Join-Path $PSScriptRoot 'test-themes.ps1')
 if(!$?){throw 'Native theme tests failed.'}
 & (Join-Path $PSScriptRoot 'test-private-bootstrap.ps1')
 if(!$?){throw 'Private bootstrap security tests failed.'}
 & (Join-Path $PSScriptRoot 'test-native-security.ps1')
 if(!$?){throw 'Native security tests failed.'}
 & (Join-Path $PSScriptRoot 'test-dependency-integrity.ps1')
 if(!$?){throw 'Dependency integrity tests failed.'}
 & (Join-Path $PSScriptRoot 'test-app-updates.ps1')
 if(!$?){throw 'Native update tests failed.'}
 & (Join-Path $PSScriptRoot 'test-installer.ps1')
 if(!$?){throw 'Installer policy tests failed.'}
}finally{Pop-Location}

$ErrorActionPreference='Stop'
$wsRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'bootstrap-installer.ps1')
$wsCompiler=Initialize-WsInstaller $wsRoot
$wsOutput=Join-Path $wsRoot 'verification\installer-policy';[void](New-Item -ItemType Directory -Force -Path $wsOutput)
& (Join-Path $wsCompiler 'ISCC.exe') '/Q' (Join-Path $wsRoot 'tests\InstallerPolicy.iss')
if($LASTEXITCODE -ne 0){throw 'Installer policy compilation failed.'}
$wsReport=Join-Path $wsOutput ('result-'+[Guid]::NewGuid().ToString('N')+'.txt')
# This separate test EXE returns from InitializeSetup before a wizard, file copy,
# registry/shortcut write, prerequisite install or application launch can occur.
$wsProcess=Start-Process -FilePath (Join-Path $wsOutput 'InstallerPolicyTests.exe') -ArgumentList @('/SP-','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/REPORT="'+$wsReport+'"')) -WindowStyle Hidden -Wait -PassThru
if(!(Test-Path -LiteralPath $wsReport) -or [IO.File]::ReadAllText($wsReport) -cnotmatch '^PASS [0-9]+$'){throw 'Installer policy test failed.'}
Write-Host ('Installer policy: '+[IO.File]::ReadAllText($wsReport)+'; no real installation, Runtime, registry, shortcut or application actions.')

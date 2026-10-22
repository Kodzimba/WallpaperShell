param([Parameter(Mandatory=$true)][string]$ReleaseDirectory)
$ErrorActionPreference='Stop'
$wsRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'bootstrap-installer.ps1')
$wsCompilerRoot=Initialize-WsInstaller $wsRoot
$wsInputs=Get-WsInstallerManifest $wsRoot
$wsRelease=[IO.Path]::GetFullPath($ReleaseDirectory)
$wsZip=Join-Path $wsRelease 'WallpaperShell-win-x64.zip'
$wsChecksum=[IO.File]::ReadAllText(($wsZip+'.sha256')).TrimEnd("`r","`n")
if($wsChecksum -cnotmatch '^[a-f0-9]{64}  WallpaperShell-win-x64\.zip$' -or (Get-FileHash -LiteralPath $wsZip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $wsChecksum.Substring(0,64)){throw 'Portable archive checksum rejected.'}
$wsConfig=Get-Content -LiteralPath (Join-Path $wsRoot 'app-release.json') -Raw | ConvertFrom-Json
& (Join-Path $PSScriptRoot 'validate-update-package.ps1') -ZipPath $wsZip -Version $wsConfig.version -ExpectedSha256 $wsChecksum.Substring(0,64)
if(!$?){throw 'Installer payload validation failed.'}
$wsStage=Join-Path $wsRoot ('.build-cache\installer-stage-'+[Guid]::NewGuid().ToString('N'))
$wsPayload=Join-Path $wsStage 'payload';[void](New-Item -ItemType Directory -Force -Path $wsStage)
Expand-Archive -LiteralPath $wsZip -DestinationPath $wsPayload
$wsManifest=Get-Content -LiteralPath (Join-Path $wsPayload 'package-manifest.json') -Raw | ConvertFrom-Json
$wsFiles=[Collections.Generic.List[string]]::new();$wsChecks=[Collections.Generic.List[string]]::new()
$wsChecks.Add('procedure CheckPayloadTargets;');$wsChecks.Add('begin')
foreach($wsEntry in $wsManifest.files){
 $wsName=[string]$wsEntry.path
 if($wsName -match '["'';{}\r\n]' -or $wsName.StartsWith('/') -or $wsName.Contains('..') -or $wsName.Contains('\')){throw 'Unsupported installer payload path.'}
 $wsRelative=$wsName.Replace('/','\');$wsParent=Split-Path -Parent $wsRelative
 $wsDestination='{app}';if($wsParent){$wsDestination+='\'+$wsParent}
 $wsFiles.Add('Source: "{#PayloadDir}\'+$wsRelative+'"; DestDir: "'+$wsDestination+'"; Flags: ignoreversion; BeforeInstall: VerifyFileTarget('''+$wsRelative+''')')
 $wsChecks.Add('  VerifyFileTarget('''+$wsRelative+''');')
}
$wsChecks.Add('end;')
# Manifest is installer metadata, not app data; its contents were validated above.
$wsFiles.Add('Source: "{#PayloadDir}\package-manifest.json"; DestDir: "{app}"; Flags: ignoreversion; BeforeInstall: VerifyFileTarget(''package-manifest.json'')')
$wsChecks.Insert($wsChecks.Count-1,'  VerifyFileTarget(''package-manifest.json'');')
$wsUtf8=[Text.UTF8Encoding]::new($true)
[IO.File]::WriteAllLines((Join-Path $wsStage 'payload-files.iss'),$wsFiles,$wsUtf8)
[IO.File]::WriteAllLines((Join-Path $wsStage 'payload-checks.iss'),$wsChecks,$wsUtf8)
[IO.File]::WriteAllText((Join-Path $wsStage 'prerequisites.iss'),('#define WebViewSHA256 "'+$wsInputs.webview2.sha256+'"'+"`r`n"+'#define DotNetSHA256 "'+$wsInputs.dotnet48.sha256+'"'+"`r`n"),$wsUtf8)
$wsExe=Join-Path $wsRelease 'WallpaperShell-Setup-x64.exe';if(Test-Path -LiteralPath $wsExe){throw 'Installer already exists; use a new release directory.'}
& (Join-Path $wsCompilerRoot 'ISCC.exe') '/Q' ('/DAppVersion='+$wsConfig.version) ('/DAppIcon='+(Join-Path $wsRoot 'identity\application.ico')) ('/DPayloadDir='+$wsPayload) ('/DGeneratedDir='+$wsStage) ('/DPrerequisiteDir='+(Join-Path $wsRoot '.build-cache\installer-inputs')) ('/O'+$wsRelease) (Join-Path $wsRoot 'installer\WallpaperShell.iss')
if($LASTEXITCODE -ne 0){throw 'Installer compilation failed.'}
$wsHash=(Get-FileHash -LiteralPath $wsExe -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($wsExe+'.sha256'),($wsHash+'  WallpaperShell-Setup-x64.exe'+"`n"),[Text.UTF8Encoding]::new($false))
Write-Host ('Installer prepared with '+$wsManifest.files.Count+' verified application files; no installation executed.')

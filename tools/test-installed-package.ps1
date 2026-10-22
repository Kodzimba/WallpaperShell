param([Parameter(Mandatory=$true)][string]$SetupPath)
$ErrorActionPreference='Stop'
# Destructive installation tests are restricted to a fresh, disposable hosted VM.
if($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted'){throw 'Installation integration test requires a disposable GitHub-hosted runner; nothing installed.'}
$wsRoot=Split-Path -Parent $PSScriptRoot
$wsInstall=[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\WallpaperShell'))
$wsRegistry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{1A8A7FD5-59D3-4D45-9B38-1B80C1588A2C}_is1'
if((Test-Path -LiteralPath $wsInstall) -or (Test-Path -LiteralPath $wsRegistry)){throw 'Integration test refuses to touch an existing installation.'}
$wsSetup=[IO.Path]::GetFullPath($SetupPath)
if((Get-FileHash -LiteralPath $wsSetup -Algorithm SHA256).Hash.ToLowerInvariant() -cne ([IO.File]::ReadAllText(($wsSetup+'.sha256')).Substring(0,64))){throw 'Setup fixture checksum mismatch.'}
$wsVersion=(Get-Content -LiteralPath (Join-Path $wsRoot 'app-release.json') -Raw | ConvertFrom-Json).version
$wsId=[Guid]::NewGuid().ToString('N')
function Invoke-WsSetup {
 $wsProcess=Start-Process -FilePath $wsSetup -ArgumentList @('/SP-','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/RESTARTEXITCODE=3010','/TASKS=desktopicon') -WindowStyle Hidden -Wait -PassThru
 return $wsProcess.ExitCode
}
function Assert-Ws([bool]$Ok,[string]$Name){if(!$Ok){throw ('Installer integration: '+$Name)}}
$wsCode=Invoke-WsSetup
Assert-Ws ($wsCode -in @(0,3010)) 'initial install failed'
Assert-Ws (Test-Path -LiteralPath (Join-Path $wsInstall 'bin\WallpaperShell.exe')) 'application missing'
$wsMarker=Join-Path $wsInstall '.installer-ci-fixture';[IO.File]::WriteAllText($wsMarker,$wsId)
$wsConfig=Get-Content -LiteralPath (Join-Path $wsInstall 'app-release.json') -Raw | ConvertFrom-Json
Assert-Ws ($wsConfig.version -ceq $wsVersion) 'wrong installed version'
Assert-Ws ((Get-Item -LiteralPath (Join-Path $wsInstall 'bin\WallpaperShell.exe')).VersionInfo.FileVersion -ceq ($wsVersion+'.0')) 'Windows file version differs'
$wsRegistration=Get-ItemProperty -LiteralPath $wsRegistry
Assert-Ws ($wsRegistration.DisplayVersion -ceq $wsVersion) 'uninstall registration missing'
$wsDesktop=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'WallpaperShell.lnk'
$wsMenu=Join-Path ([Environment]::GetFolderPath('Programs')) 'WallpaperShell\WallpaperShell.lnk'
$wsShell=New-Object -ComObject WScript.Shell
foreach($wsLinkPath in @($wsDesktop,$wsMenu)){
 Assert-Ws (Test-Path -LiteralPath $wsLinkPath) 'shortcut missing'
 $wsLink=$wsShell.CreateShortcut($wsLinkPath)
 Assert-Ws ($wsLink.TargetPath -ieq (Join-Path $wsInstall 'bin\WallpaperShell.exe')) 'shortcut target differs'
 Assert-Ws ($wsLink.Arguments -ceq '--desktop') 'shortcut startup mode differs'
 Assert-Ws ($wsLink.WorkingDirectory -ieq $wsInstall) 'shortcut working directory differs'
 Assert-Ws ($wsLink.IconLocation -like '*\bin\WallpaperShell.exe,0') 'shortcut icon differs'
}
$wsTheme=Join-Path $wsInstall 'runtime\companion\.app-theme.json'
Assert-Ws ((Get-Content -LiteralPath $wsTheme -Raw | ConvertFrom-Json).theme -ceq 'luna-blue') 'fresh theme differs'
[void](New-Item -ItemType Directory -Path (Join-Path $wsInstall 'data'))
$wsSentinel=Join-Path $wsInstall 'data\synthetic-user-settings.json'
[IO.File]::WriteAllText($wsSentinel,'{"fixture":"preserve"}')
[IO.File]::WriteAllText($wsTheme,'{"theme":"classic"}')
$wsCode=Invoke-WsSetup;Assert-Ws ($wsCode -in @(0,3010)) 'repair install failed'
Assert-Ws ([IO.File]::ReadAllText($wsSentinel) -ceq '{"fixture":"preserve"}') 'repair changed synthetic user settings'
Assert-Ws ((Get-Content -LiteralPath $wsTheme -Raw | ConvertFrom-Json).theme -ceq 'classic') 'repair changed selected theme'
# A later ZIP update changes app-release.json but not Inno's registry version.
$wsConfigPath=Join-Path $wsInstall 'app-release.json';$wsConfigBytes=[IO.File]::ReadAllBytes($wsConfigPath)
$wsNewer=$wsConfig;$wsNewer.version='999.0.0';[IO.File]::WriteAllText($wsConfigPath,($wsNewer | ConvertTo-Json))
$wsCode=Invoke-WsSetup;Assert-Ws ($wsCode -notin @(0,3010)) 'setup allowed downgrade'
Assert-Ws ((Get-Content -LiteralPath $wsConfigPath -Raw | ConvertFrom-Json).version -ceq '999.0.0') 'downgrade modified version marker'
[IO.File]::WriteAllBytes($wsConfigPath,$wsConfigBytes)
# A directory junction at an exact payload filename must be rejected before copying.
$wsIcon=Join-Path $wsInstall 'bin\WallpaperShell.exe';$wsIconBytes=[IO.File]::ReadAllBytes($wsIcon)
$wsOutside=Join-Path $env:RUNNER_TEMP ('wallpapershell-link-fixture-'+$wsId)
[void](New-Item -ItemType Directory -Path $wsOutside)
[IO.File]::WriteAllText((Join-Path $wsOutside 'sentinel.txt'),'untouched')
Remove-Item -LiteralPath $wsIcon
[void](New-Item -ItemType Junction -Path $wsIcon -Value $wsOutside)
try{
 $wsCode=Invoke-WsSetup;Assert-Ws ($wsCode -notin @(0,3010)) 'setup followed a junction'
 Assert-Ws ([IO.File]::ReadAllText((Join-Path $wsOutside 'sentinel.txt')) -ceq 'untouched') 'junction destination changed'
}finally{
 Assert-Ws ((Get-Item -LiteralPath $wsIcon -Force).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) 'junction fixture identity differs'
 # Nonrecursive .NET delete removes only this exact link, never its target.
 [IO.Directory]::Delete($wsIcon)
 [IO.File]::WriteAllBytes($wsIcon,$wsIconBytes)
}
$wsUninstall=Join-Path $wsInstall 'unins000.exe'
$wsUninstaller=Start-Process -FilePath $wsUninstall -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -WindowStyle Hidden -Wait -PassThru
Assert-Ws ($wsUninstaller.ExitCode -eq 0) 'uninstall failed'
Assert-Ws (!(Test-Path -LiteralPath (Join-Path $wsInstall 'bin\WallpaperShell.exe'))) 'uninstall left original app executable'
Assert-Ws (!(Test-Path -LiteralPath $wsRegistry)) 'uninstall left registration'
Assert-Ws (!(Test-Path -LiteralPath $wsDesktop) -and !(Test-Path -LiteralPath $wsMenu)) 'uninstall left shortcuts'
Assert-Ws ([IO.File]::ReadAllText($wsSentinel) -ceq '{"fixture":"preserve"}') 'uninstall removed synthetic user settings'
Assert-Ws ((Get-Content -LiteralPath $wsTheme -Raw | ConvertFrom-Json).theme -ceq 'classic') 'uninstall removed selected theme'
Assert-Ws (!(Get-Process -Name WallpaperShell -ErrorAction SilentlyContinue)) 'silent installation launched the wallpaper'
# Cleanup only our own marked fixture after checking the exact resolved root.
$wsResolved=(Resolve-Path -LiteralPath $wsInstall).Path
Assert-Ws ($wsResolved -ieq $wsInstall -and [IO.File]::ReadAllText($wsMarker) -ceq $wsId) 'cleanup scope differs'
Assert-Ws (!@(Get-ChildItem -LiteralPath $wsInstall -Recurse -Force | Where-Object {$_.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)}).Count) 'cleanup refuses linked fixture'
Remove-Item -LiteralPath $wsResolved -Recurse -Force
Remove-Item -LiteralPath (Join-Path $wsOutside 'sentinel.txt')
[IO.Directory]::Delete($wsOutside)
Write-Host 'Hosted installer integration PASS: install, shortcuts/icon, repair, downgrade/junction rejection, uninstall and synthetic-settings preservation; wallpaper never launched.'

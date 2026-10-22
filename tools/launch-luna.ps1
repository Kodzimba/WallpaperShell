param([switch]$Desktop)
$ErrorActionPreference='Stop'
$lunaAppRoot=Split-Path -Parent $PSScriptRoot
$lunaAppExe=Join-Path $lunaAppRoot 'bin\WallpaperShell.exe'
if(!(Test-Path -LiteralPath $lunaAppExe)){& (Join-Path $PSScriptRoot 'build.ps1')}
$lunaRunning=@(Get-Process -Name 'WallpaperShell' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $lunaAppExe})
if(!$lunaRunning.Count){
 $lunaArgs=@('--no-speedtest')
 if($Desktop){$lunaArgs+='--desktop'}
 Start-Process -FilePath $lunaAppExe -ArgumentList $lunaArgs -WorkingDirectory $lunaAppRoot -WindowStyle Hidden
}
$lunaReady=$false
for($lunaAttempt=0;$lunaAttempt -lt 80;$lunaAttempt++){
 try{
  $lunaControlKey=[IO.File]::ReadAllText((Join-Path $lunaAppRoot 'data\private\control.key')).Trim()
  if($lunaControlKey -notmatch '^[a-f0-9]{64}$'){throw 'Local capability is not ready.'}
  $lunaHeaders=@{'Origin'='null';'X-VioletGhost-Action'='desktop';'X-VioletGhost-Key'=$lunaControlKey}
  $lunaReply=Invoke-RestMethod -Uri 'http://127.0.0.1:8767/controls' -Method Post -ContentType 'application/json' -Headers $lunaHeaders -Body '{"kind":"theme","value":"luna-blue"}' -TimeoutSec 3
  if($lunaReply.source.data.requestedTheme -eq 'luna-blue'){$lunaReady=$true;break}
 }catch{}
 Start-Sleep -Milliseconds 250
}
if(!$lunaReady){throw 'Luna Blue did not switch. Close WallpaperShell dialogs and run RUN_LUNA_BLUE.cmd again.'}
Write-Host 'Luna Blue selected. Existing app settings and other theme layouts are preserved.'

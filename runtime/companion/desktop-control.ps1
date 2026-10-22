# Loaded inside the existing sensor worker. Only fixed local choices are accepted.
try {if(-not ('VGDesktop' -as [type])){Add-Type -Path (Join-Path $env:VG_DESKTOP_ROOT '..\..\bin\PaperGreen.SensorInterop.dll') -ErrorAction Stop}} catch {}
if(-not ('VGDesktop' -as [type])){Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $env:VG_DESKTOP_ROOT 'DesktopInterop.cs') -Encoding UTF8 -Raw)}
function Get-VGDesktop {
 $volume=$null;try{$volume=[VGDesktop]::Volume()}catch{}
 @{ displays=[VGDesktop]::Displays(); audio=@([VGDesktop]::AudioChoices()); volume=$volume }
}
function Invoke-VGDesktop($command) {
 if ($command.kind -eq 'audio' -and $command.value -cin @('headphones','speakers','tv')) {
  $before=@([VGDesktop]::Outputs())
  try {
   [VGDesktop]::SelectAudio($command.value)
   $choice=@([VGDesktop]::AudioChoices() | Where-Object {$_.key -ceq $command.value -and $_.selected})
   if ($choice.Count -ne 1) {throw 'Audio switch not confirmed'}
  } catch {
   [VGDesktop]::RestoreOutputs(($before | Where-Object console | Select-Object -First 1).id,($before | Where-Object selected | Select-Object -First 1).id)
   throw
  }
 } elseif ($command.kind -eq 'displays' -and $command.value -cin @('single','dual')) {
  $before=[VGDesktop]::CaptureDisplays()
  $state=[VGDesktop]::Displays()
  $cache=Join-Path $env:VG_DESKTOP_ROOT '.desktop-displays.json'
  if ($state.mode -ne $command.value) {
   try {
    if ($command.value -eq 'single') {
     if ($state.mode -ne 'dual') {throw 'Expected primary 2K plus secondary monitor'}
     $before | ConvertTo-Json -Compress | Set-Content -LiteralPath $cache -Encoding UTF8
     [VGDesktop]::ApplyDisplays($before,$true)
    } elseif (Test-Path -LiteralPath $cache) {
     $saved=Get-Content -LiteralPath $cache -Encoding UTF8 -Raw | ConvertFrom-Json
     $restore=[VGDesktop+DisplaySnapshot]::new()
     $restore.paths=$saved.paths;$restore.modes=$saved.modes;$restore.pathCount=$saved.pathCount;$restore.modeCount=$saved.modeCount
     if($restore.pathCount -ne 2){throw 'Invalid dual monitor snapshot'}
     [VGDesktop]::ApplyDisplays($restore,$false)
    } else {[VGDesktop]::Extend()}
    Start-Sleep -Milliseconds 700
    if ([VGDesktop]::Displays().mode -ne $command.value) {throw 'Display switch not confirmed'}
   } catch {
    [VGDesktop]::ApplyDisplays($before,$false)
    throw
   }
  }
 } elseif($command.kind -ceq 'volume' -and $command.value -is [int] -and $command.value -ge 0 -and $command.value -le 100 -and $command.target -cmatch '^[a-f0-9]{64}$') {
  [VGDesktop]::SetVolume($command.target,$command.value)
  $actual=[VGDesktop]::Volume()
  if($actual.target -cne $command.target -or [Math]::Abs($actual.percent-$command.value) -gt 0.6){throw 'Volume change not confirmed'}
 } else {throw 'Unknown desktop control'}
 Get-VGDesktop
}

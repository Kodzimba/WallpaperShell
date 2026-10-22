$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$roots=@([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory')) | Where-Object {$_} | Select-Object -Unique
$mode=$env:VG_LAUNCH_MODE
if($mode -ceq 'standard-background'){
 # Engine can leave a still preview as the Windows background. Prefer the most
 # recent real Windows image; never use a project screenshot or a remote path.
 $current=(Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop' -Name Wallpaper).Wallpaper
 $history=Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers' -ErrorAction SilentlyContinue
 $candidates=@($current)+@(0..4 | ForEach-Object {$history.('BackgroundHistoryPath'+$_)})+@(Join-Path $env:SystemRoot 'Web\Wallpaper\Windows\img0.jpg')
 $background=$candidates | Where-Object {$_ -and $_ -match '^[A-Za-z]:\\' -and [IO.Path]::GetFileName($_) -notlike 'WallpaperEngineOverride*' -and [IO.Path]::GetExtension($_) -match '^\.(jpg|jpeg|png|bmp)$' -and (Test-Path -LiteralPath $_ -PathType Leaf)} | Select-Object -First 1
 if(!$background){throw 'Standard Windows wallpaper unavailable'}
 Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VGStandardBackground {
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 public static extern bool SystemParametersInfo(uint action,uint param,string value,uint flags);
}
'@
 # Engine may finish restoring its cached background asynchronously after its
 # close command returns. Confirm the real Windows setting stays in place.
 for($backgroundAttempt=0;$backgroundAttempt -lt 4;$backgroundAttempt++){
  if(![VGStandardBackground]::SystemParametersInfo(20,0,$background,3)){throw 'Windows did not restore the background'}
  Start-Sleep -Milliseconds 750
  $installed=(Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop' -Name Wallpaper).Wallpaper
  if(![string]::Equals($installed,$background,[StringComparison]::OrdinalIgnoreCase)){continue}
  Start-Sleep -Milliseconds 750
  $installed=(Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop' -Name Wallpaper).Wallpaper
  if([string]::Equals($installed,$background,[StringComparison]::OrdinalIgnoreCase)){[Console]::WriteLine('{"ok":true}');return}
 }
 throw 'Windows background did not remain restored'
}
if($mode -ceq 'roots') {
 [Console]::WriteLine((@{roots=@($roots)} | ConvertTo-Json -Compress));return
}
if($mode -ceq 'move-batch' -or $mode -ceq 'recycle-batch') {
 try {
  $expected=Join-Path $env:VG_LAUNCH_ROOT '.launcher-file-request.json'
  if([IO.Path]::GetFullPath($env:VG_LAUNCH_MANIFEST) -cne [IO.Path]::GetFullPath($expected)){throw 'Invalid request path'}
  $request=Get-Content -LiteralPath $expected -Raw -Encoding UTF8 | ConvertFrom-Json
  if([Math]::Abs([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$request.issuedAt) -gt 30000){throw 'Expired file request'}
  if(($request.action+'-batch') -cne $mode){throw 'Invalid operation'}
  $files=@($request.files);if($files.Count -lt 1 -or $files.Count -gt 100){throw 'Invalid file count'}
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($file in $files){$target=[IO.Path]::GetFullPath($file);if([IO.Path]::GetDirectoryName($target) -notin $roots -or !$seen.Add($target)){throw 'Invalid source'};$item=Get-Item -LiteralPath $target -Force;if($item.PSIsContainer -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Not a regular file'}}
  if($mode -ceq 'move-batch'){
   $folder=[IO.Path]::GetFullPath($request.folder);if([IO.Path]::GetDirectoryName($folder) -notin $roots){throw 'Outside desktop'}
   $directory=Get-Item -LiteralPath $folder -Force;if(!$directory.PSIsContainer -or $directory.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Not a regular folder'}
   $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
   foreach($file in $files){$name=[IO.Path]::GetFileName($file);if(!$names.Add($name) -or (Test-Path -LiteralPath (Join-Path $folder $name))){[Console]::WriteLine('{"ok":false,"code":"exists"}');return}}
  }
  Add-Type -Path (Join-Path $env:VG_LAUNCH_ROOT 'LauncherFiles.cs')
  $completed=if($mode -ceq 'move-batch'){[VGLauncherFiles]::MoveMany([string[]]$files,$folder)}else{[VGLauncherFiles]::RecycleMany([string[]]$files)}
  [Console]::WriteLine((@{ok=(@($completed | Where-Object {!$_}).Count -eq 0);completed=@($completed)}|ConvertTo-Json -Compress))
 }catch{[Console]::WriteLine('{"ok":false,"code":"failed"}')}
 return
}
if($mode -ceq 'move' -or $mode -ceq 'recycle') {
 try {
  $target=[IO.Path]::GetFullPath($env:VG_LAUNCH_TARGET)
  if([IO.Path]::GetDirectoryName($target) -notin $roots){throw 'Outside desktop'}
  $item=Get-Item -LiteralPath $target -Force
  if($item.PSIsContainer -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Not a regular file'}
  if($mode -ceq 'move') {
   $folder=[IO.Path]::GetFullPath($env:VG_LAUNCH_FOLDER)
   if([IO.Path]::GetDirectoryName($folder) -notin $roots){throw 'Outside desktop'}
   $directory=Get-Item -LiteralPath $folder -Force
   if(!$directory.PSIsContainer -or $directory.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Not a regular folder'}
   if(Test-Path -LiteralPath (Join-Path $folder $item.Name)){[Console]::WriteLine('{"ok":false,"code":"exists"}');return}
  }
  Add-Type -Path (Join-Path $env:VG_LAUNCH_ROOT 'LauncherFiles.cs')
  if($mode -ceq 'move'){[VGLauncherFiles]::Move($target,$folder)}else{[VGLauncherFiles]::Recycle($target)}
  [Console]::WriteLine('{"ok":true}')
 }catch{[Console]::WriteLine('{"ok":false,"code":"failed"}')}
 return
}
if($mode -ceq 'open' -or $mode -ceq 'reveal' -or $mode -ceq 'system') {
 if($mode -ceq 'system') {
  $locations=@{thispc='shell:MyComputerFolder';recyclebin='shell:RecycleBinFolder';desktop=[Environment]::GetFolderPath('Desktop')}
  if(!$locations.ContainsKey($env:VG_LAUNCH_SYSTEM)){throw 'Unknown system location'}
  $start=[Diagnostics.ProcessStartInfo]::new('explorer.exe');$start.Arguments='"'+$locations[$env:VG_LAUNCH_SYSTEM]+'"'
 } else {
  $target=[IO.Path]::GetFullPath($env:VG_LAUNCH_TARGET)
  if([IO.Path]::GetDirectoryName($target) -notin $roots){throw 'Target is outside the desktop'}
  $item=Get-Item -LiteralPath $target -Force
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse points are not launch targets'}
  if($mode -ceq 'reveal') {$start=[Diagnostics.ProcessStartInfo]::new('explorer.exe');$start.Arguments='/select,"'+$target+'"'}
  else {$start=[Diagnostics.ProcessStartInfo]::new($target)}
 }
 $start.UseShellExecute=$true
 [Diagnostics.Process]::Start($start) | Out-Null
 [Console]::WriteLine('{"ok":true}');return
}
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $env:VG_LAUNCH_ROOT 'LauncherInterop.cs') -Encoding UTF8 -Raw) -ReferencedAssemblies System.Drawing
if($mode -ceq 'icons-get') {[Console]::WriteLine((@{visible=[VGLauncherShell]::IconsVisible()} | ConvertTo-Json -Compress));return}
if($mode -ceq 'icons-set') {
 if($env:VG_LAUNCH_VISIBLE -cnotin @('true','false')){throw 'Invalid visibility'}
 [VGLauncherShell]::SetIconsVisible($env:VG_LAUNCH_VISIBLE -ceq 'true')
 [Console]::WriteLine((@{visible=[VGLauncherShell]::IconsVisible()} | ConvertTo-Json -Compress));return
}
if($mode -ceq 'icons') {
 function Get-VGSteamIconTarget($shortcutPath,$iconPath) {
  try {
   $gameLink=[IO.File]::ReadAllText($shortcutPath)
   $appId=[regex]::Match($gameLink,'(?im)^URL=steam://rungameid/(\d+)\s*$').Groups[1].Value
   $iconMatch=[regex]::Match($iconPath,'(?i)^(.*)\\steam\\games\\[^\\]+\.ico$')
   if(!$appId -or !$iconMatch.Success){return $null}
   $steamRoot=$iconMatch.Groups[1].Value;$libraries=@($steamRoot);$config=Join-Path $steamRoot 'steamapps/libraryfolders.vdf'
   if(Test-Path -LiteralPath $config){$libraries+=([regex]::Matches([IO.File]::ReadAllText($config),'"path"\s*"([^"]+)"') | ForEach-Object {$_.Groups[1].Value.Replace('\\','\')})}
   foreach($library in ($libraries|Select-Object -Unique)) {
    if($library -notmatch '^[a-zA-Z]:\\'){continue}
    $acf=Join-Path $library ('steamapps/appmanifest_'+$appId+'.acf');if(!(Test-Path -LiteralPath $acf)){continue}
    $install=[regex]::Match([IO.File]::ReadAllText($acf),'"installdir"\s*"([^"]+)"').Groups[1].Value
    if(!$install -or $install -match '[\\/:]' -or $install -in @('.','..')){continue}
    $folder=Join-Path $library ('steamapps/common/'+$install)
    $candidates=@(Get-ChildItem -LiteralPath $folder -File -Filter '*.exe' | Where-Object {$_.Name -notmatch '(?i)crash|unins|setup|redist|launcher|server|report|benchmark' -and !($_.Attributes -band [IO.FileAttributes]::ReparsePoint)})
    if($candidates.Count -eq 1){return $candidates[0].FullName}
   }
  }catch{}
  return $null
 }
 $manifest=Get-Content -LiteralPath $env:VG_LAUNCH_MANIFEST -Encoding UTF8 -Raw | ConvertFrom-Json
 $result=@{}
 $shortcuts=New-Object -ComObject WScript.Shell
 foreach($entry in $manifest) {
  try {
   $target=[IO.Path]::GetFullPath($entry.path)
   if([IO.Path]::GetDirectoryName($target) -notin $roots -or $entry.id -cnotmatch '^[a-f0-9]{64}$'){continue}
   $iconTarget=$target;$iconIndex=0
   if([IO.Path]::GetExtension($target) -ieq '.lnk') {
    $shortcut=$shortcuts.CreateShortcut($target)
    $resolved=[Environment]::ExpandEnvironmentVariables($shortcut.TargetPath)
    if($resolved -match '^[a-zA-Z]:\\' -and (Test-Path -LiteralPath $resolved)){$iconTarget=$resolved}
    $location=[regex]::Match($shortcuts.CreateShortcut($target).IconLocation,'^(.*),(-?\d+)$')
    if($location.Success){$explicit=[Environment]::ExpandEnvironmentVariables($location.Groups[1].Value.Trim('"'));if($explicit -match '^[a-zA-Z]:\\' -and (Test-Path -LiteralPath $explicit)){$iconTarget=$explicit;$iconIndex=[int]$location.Groups[2].Value}}
   } elseif([IO.Path]::GetExtension($target) -ieq '.url') {
    $iconLine=Get-Content -LiteralPath $target | Where-Object {$_ -match '^IconFile='} | Select-Object -First 1
    if($iconLine){$resolved=[Environment]::ExpandEnvironmentVariables($iconLine.Substring(9));if($resolved -match '^[a-zA-Z]:\\' -and (Test-Path -LiteralPath $resolved)){$iconTarget=$resolved}}
   }
   $thumbnail=$null
   if($entry.preview -eq $true){$thumbnail=[VGLauncherShell]::ImageFor($target,$true)}
   $icon=if($iconIndex -ne 0){[VGLauncherShell]::ResourceImage($iconTarget,$iconIndex)}else{[VGLauncherShell]::ImageFor($iconTarget,$false)}
   if([IO.Path]::GetExtension($target) -ieq '.url' -and $icon -and [Math]::Max($icon.width,$icon.height) -lt 128){
    $gameExe=Get-VGSteamIconTarget $target $iconTarget
    if($gameExe){$gameIcon=[VGLauncherShell]::ImageFor($gameExe,$false);if($gameIcon -and [Math]::Max($gameIcon.width,$gameIcon.height) -gt [Math]::Max($icon.width,$icon.height)){$icon=$gameIcon}}
   }
   $result[$entry.id]=@{icon=$icon;thumbnail=$thumbnail}
  }catch{}
 }
 [Console]::WriteLine((ConvertTo-Json -InputObject $result -Compress -Depth 6));return
}
throw 'Unknown launcher operation'

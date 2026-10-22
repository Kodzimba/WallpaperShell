$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
try {if(-not ('VGMediaCover' -as [type])){Add-Type -Path (Join-Path $env:VG_DESKTOP_ROOT '..\..\bin\PaperGreen.MediaInterop.dll') -ErrorAction Stop}} catch {}
if(-not ('VGMediaCover' -as [type])){
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class VGMediaCover {
 [DllImport("shcore.dll", PreserveSig=false)]
 private static extern void CreateStreamOverRandomAccessStream([MarshalAs(UnmanagedType.IUnknown)] object source, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IStream stream);
 public static byte[] Read(object source) {
  Guid iid=typeof(IStream).GUID; IStream stream;
  CreateStreamOverRandomAccessStream(source,ref iid,out stream);
  try {
   System.Runtime.InteropServices.ComTypes.STATSTG info; stream.Stat(out info,1);
   if(info.cbSize<=0 || info.cbSize>1048576)return null;
   byte[] bytes=new byte[(int)info.cbSize]; IntPtr read=Marshal.AllocCoTaskMem(4);
   try { stream.Read(bytes,bytes.Length,read);return Marshal.ReadInt32(read)==bytes.Length?bytes:null; }
   finally { Marshal.FreeCoTaskMem(read); }
  } finally { Marshal.ReleaseComObject(stream); }
 }
}
'@
}
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1})[0]
function Await-VG($operation,$type){
 $task=$asTask.MakeGenericMethod($type).Invoke($null,@($operation))
 if(!$task.Wait(2000)){throw 'Media read timeout'}
 return $task.Result
}
$managerType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$propertiesType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$streamType=[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
$manager=Await-VG ($managerType::RequestAsync()) $managerType
$lastKey='';$cover=$null
function Get-VGMediaKey($session,$properties){
 $hash=[Security.Cryptography.SHA256]::Create()
 try {return [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($session.SourceAppUserModelId+'|'+$properties.Title+'|'+$properties.Artist))).Replace('-','').ToLowerInvariant()} finally {$hash.Dispose()}
}
$commandFile=Join-Path $env:VG_DESKTOP_ROOT '.media-command.json'
while($true){
 $reply=$null;$failure=$null
 if(Test-Path -LiteralPath $commandFile){
  try{
   $command=Get-Content -LiteralPath $commandFile -Encoding UTF8 -Raw | ConvertFrom-Json
   Remove-Item -LiteralPath $commandFile
   $reply=$command.id
   if([Math]::Abs([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$command.issuedAt) -gt 30000 -or $command.kind -cne 'media' -or $command.value -cnotin @('play','pause','previous','next')){throw 'Invalid media command'}
   $target=$manager.GetCurrentSession();if(!$target){throw 'No media session'}
   $properties=Await-VG ($target.TryGetMediaPropertiesAsync()) $propertiesType
   if((Get-VGMediaKey $target $properties) -cne $command.session){throw 'Media session changed'}
   $controls=$target.GetPlaybackInfo().Controls
   $operation=switch -CaseSensitive ($command.value){
    'play'{if(!$controls.IsPlayEnabled){throw 'Play unavailable'};$target.TryPlayAsync()}
    'pause'{if(!$controls.IsPauseEnabled){throw 'Pause unavailable'};$target.TryPauseAsync()}
    'previous'{if(!$controls.IsPreviousEnabled){throw 'Previous unavailable'};$target.TrySkipPreviousAsync()}
    'next'{if(!$controls.IsNextEnabled){throw 'Next unavailable'};$target.TrySkipNextAsync()}
   }
   if(!(Await-VG $operation ([bool]))){throw 'Media command was rejected'}
   if($command.value -cin @('play','pause')){
    $expected=if($command.value -ceq 'play'){'Playing'}else{'Paused'}
    for($attempt=0;$attempt -lt 8;$attempt++){if($target.GetPlaybackInfo().PlaybackStatus.ToString() -eq $expected){break};Start-Sleep -Milliseconds 100}
    if($target.GetPlaybackInfo().PlaybackStatus.ToString() -ne $expected){throw 'Playback state not confirmed'}
   }
  }catch{$failure=$_.Exception.Message}
 }
 try{
  $session=$manager.GetCurrentSession()
  if(!$session){$out=@{status='unavailable';updatedAt=$null;data=$null;identity='Windows SMTC'}}
  else{
   $properties=Await-VG ($session.TryGetMediaPropertiesAsync()) $propertiesType
   $playback=$session.GetPlaybackInfo();$timeline=$session.GetTimelineProperties()
   $key=$session.SourceAppUserModelId+'|'+$properties.Title+'|'+$properties.Artist
   if($key -ne $lastKey){
    $cover=$null
    try{
     if($properties.Thumbnail){
      $stream=Await-VG ($properties.Thumbnail.OpenReadAsync()) $streamType
      try{
       $bytes=[VGMediaCover]::Read($stream)
       if($bytes -and $bytes.Length -gt 12){
        $mime=if($bytes[0] -eq 255 -and $bytes[1] -eq 216){'image/jpeg'}elseif($bytes[0] -eq 137 -and [Text.Encoding]::ASCII.GetString($bytes,1,3) -eq 'PNG'){'image/png'}elseif([Text.Encoding]::ASCII.GetString($bytes,0,4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($bytes,8,4) -eq 'WEBP'){'image/webp'}else{$null}
        if($mime){$cover='data:'+$mime+';base64,'+[Convert]::ToBase64String($bytes)}
       }
      }finally{try{([IDisposable]$stream).Dispose()}catch{}}
     }
    }catch{$cover=$null}
    $lastKey=$key
   }
   $state=switch($playback.PlaybackStatus.ToString()){'Playing'{'playing'}'Paused'{'paused'}'Stopped'{'stopped'}default{'waiting'}}
   $controls=$playback.Controls
   $out=@{status='ok';updatedAt=[DateTime]::UtcNow.ToString('o');identity='Windows SMTC / '+$session.SourceAppUserModelId;data=@{title=$properties.Title;artist=$properties.Artist;playback=$state;position=$timeline.Position.TotalSeconds;duration=$timeline.EndTime.TotalSeconds;timelineUpdatedAt=$timeline.LastUpdatedTime.UtcDateTime.ToString('o');playbackRate=$playback.PlaybackRate;thumbnail=$cover;session=(Get-VGMediaKey $session $properties);controls=@{play=[bool]$controls.IsPlayEnabled;pause=[bool]$controls.IsPauseEnabled;previous=[bool]$controls.IsPreviousEnabled;next=[bool]$controls.IsNextEnabled}}}
  }
 }catch{$out=@{status='unavailable';updatedAt=$null;data=$null;identity='Windows SMTC'}}
 if($reply){$out.reply=$reply;$out.ok=($null -eq $failure);if($failure){$out.error=$failure}}
 [Console]::WriteLine(($out | ConvertTo-Json -Compress -Depth 5))
 Start-Sleep -Milliseconds 3000
}

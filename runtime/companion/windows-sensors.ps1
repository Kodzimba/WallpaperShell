$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {if(-not ('VGSensors' -as [type])){Add-Type -Path (Join-Path $env:VG_DESKTOP_ROOT '..\..\bin\PaperGreen.SensorInterop.dll') -ErrorAction Stop}} catch {}
if(-not ('VGSensors' -as [type])){
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VGSensors {
 [StructLayout(LayoutKind.Sequential)] public struct Memory {
  public uint length, load; public ulong total, available, pageTotal, pageAvailable, virtualTotal, virtualAvailable, extended;
 }
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GlobalMemoryStatusEx(ref Memory m);
 [DllImport("iphlpapi.dll")] public static extern int GetBestInterface(uint destination, out uint index);
 public static uint Route() { uint index; return GetBestInterface(BitConverter.ToUInt32(new byte[]{1,1,1,1},0),out index)==0 ? index : 0; }
}
'@
}
$clock = [Diagnostics.Stopwatch]::StartNew()
try {. ([scriptblock]::Create((Get-Content -LiteralPath (Join-Path $env:VG_DESKTOP_ROOT 'desktop-control.ps1') -Encoding UTF8 -Raw)));$desktopReady=$true} catch {$desktopReady=$false;[Console]::Error.WriteLine('Desktop API initialization failed: '+$_.Exception.Message)}
$commandFile=Join-Path $env:VG_DESKTOP_ROOT '.desktop-command.json'
try {
 if(-not ('VGLauncherWheel' -as [type])){Add-Type -Path (Join-Path $env:VG_DESKTOP_ROOT 'LauncherWheel.cs')}
 [Console]::WriteLine((@{launcherInputReady=[VGLauncherWheel]::Start()} | ConvertTo-Json -Compress))
} catch { [Console]::WriteLine('{"launcherInputReady":false}') }
while ($true) {
 if(Test-Path -LiteralPath $commandFile){
   try{
    $line=Get-Content -LiteralPath $commandFile -Encoding UTF8 -Raw
    Remove-Item -LiteralPath $commandFile
    $command=$line | ConvertFrom-Json
    if([Math]::Abs([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$command.issuedAt) -gt 30000){throw 'Expired desktop command'}
    if(!$desktopReady){throw 'Desktop API unavailable'}
    $data=Invoke-VGDesktop $command
    [Console]::WriteLine((@{reply=$command.id;ok=$true;desktop=$data;measuredAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress -Depth 6))
   }catch{[Console]::WriteLine((@{reply=$command.id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress))}
 }
 $out = @{ measuredAt = [DateTime]::UtcNow.ToString('o'); monotonicSeconds = $clock.Elapsed.TotalSeconds; ram = $null; network = $null }
 try {
  $memory = [VGSensors+Memory]::new(); $memory.length = [Runtime.InteropServices.Marshal]::SizeOf($memory)
  if ([VGSensors]::GlobalMemoryStatusEx([ref]$memory)) { $out.ram = @{ usedBytes = $memory.total - $memory.available; totalBytes = $memory.total } }
 } catch {}
 if($desktopReady){try{$out.desktop=Get-VGDesktop}catch{$out.desktop=$null}}
 try {
  $index = [VGSensors]::Route()
  foreach ($nic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
   try {
   if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback') { continue }
   $ip = $nic.GetIPProperties().GetIPv4Properties()
   if ($ip -and $ip.Index -eq $index) {
    $stats = $nic.GetIPv4Statistics()
    $out.network = @{ id = $nic.Id; adapter = $nic.Name; description = $nic.Description; index = $index; rx = $stats.BytesReceived; tx = $stats.BytesSent; linkSpeedBitsPerSecond = $nic.Speed; routeTarget = '1.1.1.1' }
    break
   }
   } catch { continue }
  }
 } catch {}
 $out.measuredAt = [DateTime]::UtcNow.ToString('o')
 $out.monotonicSeconds = $clock.Elapsed.TotalSeconds
 [Console]::WriteLine(($out | ConvertTo-Json -Compress -Depth 6))
 Start-Sleep -Milliseconds 2500
}

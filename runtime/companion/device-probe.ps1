# Read-only Windows inventory/cache. No pairing, HID polling, device writes,
# audio changes, IP/MAC addresses or user file enumeration.
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {if(-not ('PGDeviceRoute' -as [type])){Add-Type -Path (Join-Path $env:VG_DESKTOP_ROOT '..\..\bin\PaperGreen.SensorInterop.dll') -ErrorAction Stop}} catch {}
if(-not ('PGDeviceRoute' -as [type])){
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class PGDeviceRoute {
 [DllImport("iphlpapi.dll")] static extern int GetBestInterface(uint destination,out uint index);
 public static uint Current(){uint index;return GetBestInterface(BitConverter.ToUInt32(new byte[]{1,1,1,1},0),out index)==0?index:0;}
 static int refresh; public static volatile bool Closed;
 public static bool Refresh(){return Interlocked.Exchange(ref refresh,0)==1;}
 public static void ReadInput(){var thread=new Thread(()=>{string line;try{while((line=Console.ReadLine())!=null)if(line=="refresh")Interlocked.Exchange(ref refresh,1);}catch{}Closed=true;});thread.IsBackground=true;thread.Start();}
}
'@
}
$clock=[Diagnostics.Stopwatch]::StartNew()
$lastDiscovery=-100000
$peripherals=@();$gpus=@();$outputs=@();$peripheralsAt=$null;$batteryApi=$false;$audioApi=$false
try {
 Add-Type -AssemblyName System.Runtime.WindowsRuntime
 $infoType=[Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
 $kindType=[Windows.Devices.Enumeration.DeviceInformationKind,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
 $collectionType=[Windows.Devices.Enumeration.DeviceInformationCollection,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
 $asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1})[0]
 $batteryApi=$true
}catch{}
try {if(-not ('VGDesktop' -as [type])){Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $env:VG_DESKTOP_ROOT 'DesktopInterop.cs') -Encoding UTF8 -Raw)};$audioApi=$true}catch{}
[PGDeviceRoute]::ReadInput()
while($true){
 if([PGDeviceRoute]::Closed){break};if([PGDeviceRoute]::Refresh()){$lastDiscovery=-100000}
 $networks=@()
 try {
  $route=[PGDeviceRoute]::Current()
  foreach($nic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()){
   if($nic.NetworkInterfaceType -eq 'Loopback' -or ($nic.NetworkInterfaceType -eq 'Tunnel' -and $nic.OperationalStatus -ne 'Up')){continue}
   try{$ip=$nic.GetIPProperties().GetIPv4Properties();$stats=$nic.GetIPv4Statistics();$networks+=@{id=$nic.Id;name=$nic.Name;description=$nic.Description;up=($nic.OperationalStatus -eq 'Up');isDefault=($ip -and $ip.Index -eq $route);rx=$stats.BytesReceived;tx=$stats.BytesSent;speed=$nic.Speed}}catch{}
  }
 }catch{}
 if($clock.Elapsed.TotalSeconds-$lastDiscovery -ge 30){
  $lastDiscovery=$clock.Elapsed.TotalSeconds;$peripheralsAt=[DateTime]::UtcNow.ToString('o');$peripherals=@();$gpus=@();$outputs=@()
  $containers=@{}
  if($batteryApi){try{
   $properties=[string[]]@('System.Devices.CategoryIds','System.Devices.Connected','System.Devices.BatteryLife','System.Devices.ModelName')
   $operation=$infoType::FindAllAsync('System.Devices.Connected:=System.StructuredQueryType.Boolean#True',$properties,$kindType::DeviceContainer)
   $task=$asTask.MakeGenericMethod($collectionType).Invoke($null,@($operation))
   if(!$task.Wait(2500)){$operation.Cancel();throw 'Device cache timeout'}
   foreach($entry in $task.Result){
    $categories=@($entry.Properties['System.Devices.CategoryIds']) -join ','
    $kind=if($categories -match 'Input.Mouse'){'mouse'}elseif($categories -match 'Input.Keyboard'){'keyboard'}else{'other'}
    $level=$entry.Properties['System.Devices.BatteryLife'];$battery=$null
    if($null -ne $level -and $level -is [ValueType] -and [double]$level -ge 0 -and [double]$level -le 100){$battery=[double]$level}
    $containerKey=$entry.Id.ToLowerInvariant().Trim('{}')
    $record=@{id=$containerKey;name=$entry.Name;kind=$kind;connected=($entry.Properties['System.Devices.Connected'] -eq $true);batteryPercent=$battery}
    $containers[$containerKey]=$record
    if($kind -ne 'other'){$peripherals+=$record}
   }
  }catch{}}
  # Device Manager/PnP is the fallback for USB receivers and generic HID mice.
  # Present driver entries do not imply that a sleeping radio device reports charge.
  try {
   foreach($mouse in @(Get-PnpDevice -PresentOnly -Class Mouse -ErrorAction Stop)){
    $containerId=$null
    try{$containerId=(Get-PnpDeviceProperty -InstanceId $mouse.InstanceId -KeyName 'DEVPKEY_Device_ContainerId' -ErrorAction Stop).Data.ToString().ToLowerInvariant().Trim('{}')}catch{}
    $identity=if($containerId){$containerId}else{$mouse.InstanceId}
    if(@($peripherals | Where-Object {$_.id -ceq $identity}).Count){continue}
    $cached=if($containerId){$containers[$containerId]}else{$null};$displayName=if($cached.name){$cached.name}else{$mouse.FriendlyName}
    $peripherals+=@{id=$identity;name=$displayName;kind='mouse';connected=$true;batteryPercent=$cached.batteryPercent}
   }
  }catch{}
  try{foreach($card in @(Get-CimInstance Win32_VideoController -OperationTimeoutSec 3)){$gpus+=@{id=$card.PNPDeviceID;name=$card.Name}}}catch{}
  if($audioApi){try{foreach($output in [VGDesktop]::Outputs()){$outputs+=@{id=$output.id;name=$output.name;selected=$output.selected}}}catch{}}
 }
 [Console]::WriteLine((@{at=[DateTime]::UtcNow.ToString('o');peripheralsAt=$peripheralsAt;seconds=$clock.Elapsed.TotalSeconds;networks=@($networks);peripherals=@($peripherals);gpus=@($gpus);outputs=@($outputs);windowsBatteryApi=$batteryApi} | ConvertTo-Json -Compress -Depth 6))
 Start-Sleep -Milliseconds 2500
}


